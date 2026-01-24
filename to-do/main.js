import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// --- CONFIGURATION ---
const CONFIG = {
    card: {
        width: 3.5,
        height: 5,
        depth: 0.2, // Thickness
        radius: 0.2
    },
    colors: {
        background: 0xffffff,
        todoText: 0xf2bb4b,
        circleStroke: 0xbbbbbb,
        itemText: 0x464646
    },
    camera: {
        todoPos: new THREE.Vector3(10, 6, 14),
        notTodoPos: new THREE.Vector3(1, -0.5, 3),
        todoFov: 45,
        notTodoFov: 100
    }
};

const HDRI_PATH = './assets/studio.hdr';
const FONT_PATH = 'https://threejs.org/examples/fonts/helvetiker_bold.typeface.json';

// --- LOADING MANAGER ---
const loadingManager = new THREE.LoadingManager();
const progressBar = document.getElementById('loading-progress-container');
const loadingOverlay = document.getElementById('loading-overlay');

loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
    const progress = (itemsLoaded / itemsTotal) * 100;
    if (progressBar) progressBar.style.width = progress + '%';
};

loadingManager.onLoad = () => {
    if (loadingOverlay) {
        loadingOverlay.style.opacity = '0';
        setTimeout(() => {
            loadingOverlay.style.display = 'none';
        }, 500);
    }
};

// --- SCENE SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.colors.background);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.copy(CONFIG.camera.todoPos);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.getElementById('canvas-container').appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// --- ENVIRONMENT (HDRI) ---
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

new RGBELoader(loadingManager)
    .load(HDRI_PATH, (texture) => {
        const envMap = pmremGenerator.fromEquirectangular(texture).texture;
        scene.environment = envMap;
        texture.dispose();
        pmremGenerator.dispose();
    });


// --- HELPER: ROUNDED RECT SHAPE ---
function createRoundedRectShape(width, height, radius) {
    const shape = new THREE.Shape();
    const x = -width / 2;
    const y = -height / 2;
    shape.moveTo(x, y + radius);
    shape.lineTo(x, y + height - radius);
    shape.quadraticCurveTo(x, y + height, x + radius, y + height);
    shape.lineTo(x + width - radius, y + height);
    shape.quadraticCurveTo(x + width, y + height, x + width, y + height - radius);
    shape.lineTo(x + width, y + radius);
    shape.quadraticCurveTo(x + width, y, x + width - radius, y);
    shape.lineTo(x + radius, y);
    shape.quadraticCurveTo(x, y, x, y + radius);
    return shape;
}

// --- TODO CARD GROUP ---
const todoGroup = new THREE.Group();
scene.add(todoGroup);

// --- NOT TO DO GROUP ---
const notTodoGroup = new THREE.Group();
notTodoGroup.visible = false;
scene.add(notTodoGroup);

// --- NEW LIGHTING SETUP ---

// 1. Fill Light (Soft light from the front-left to fill shadows)
const fillLight = new THREE.DirectionalLight(0xffffff, 1.5);
fillLight.position.set(-5, 2, 5);
scene.add(fillLight);

// 2. Strong Back Light (Rim Light)
// This creates that "glow" on the edges of the glass and text
const backLight = new THREE.SpotLight(0x02FAEB, 150); // High intensity
backLight.position.set(-10, 5, -5);                   // Behind the object
backLight.target = todoGroup;
backLight.angle = Math.PI / 4;
backLight.penumbra = 0.5;                          // Soft edges
scene.add(backLight);

// 3. Top Highlight (Adds a "sheen" to the top edge of the card)
const topLight = new THREE.PointLight(0xffffff, 5);
topLight.position.set(0, 8, 2);
scene.add(topLight);

// 4. Subtle Ambient (Keep the "black" areas from being pitch black)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(ambientLight);

// --- INTERACTIVE STATE ---
const state = {
    isCompleted: false,
    completionProgress: 0,
    mode: 'todo', // 'todo' | 'transition' | 'notTodo'
    transitionProgress: 0,
    transitionTriggered: false,
    cameraStartPos: new THREE.Vector3(),
    progressJumpValue: 0,
    progressJumpNextTime: 0,
    audioCtx: null,
    soundPlayed: false,
    audioBuffers: {},
    ambientTickSource: null,
    notTodoCount: 4,
    currentDateNum: 260123,
    notTodoList: {
        items: [],
        listGap: 0.6,
        shiftStartTime: 0,
        spawnQueue: []
    }
};

// --- RAYCASTER SETUP ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const interactables = [];

// --- GLASS MATERIAL ---
const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transmission: 1.0,           // Keeps the material see-through
    opacity: 1,                  // Keep at 1; transmission handles the transparency
    ior: 1.5,                    // Index of Refraction (1.5 is standard for glass)
    
    // --- SCATTERING / FROSTING ---
    roughness: 0.6,              // HIGHER roughness creates the blur/frost effect
    thickness: 2.0,              // Increased thickness adds depth to the blur
    
    // --- SURFACE QUALITY ---
    clearcoat: 1.0,              // Adds a shiny "outer" layer above the frosted texture
    clearcoatRoughness: 0.05,    // Keeps the outer surface sleek while the inside is blurry
    
    // --- OPTIONAL ENHANCEMENTS ---
    attenuationColor: 0xffffff,  // Color of the light as it travels through
    attenuationDistance: 0.5,    // Density of the frosting
    envMapIntensity: 0.2,
    
});

const notTodoCardMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x0b0b0b,
    roughness: 0.9,
    metalness: 0.2,
    transmission: 0.0,
    clearcoat: 0.2,
    clearcoatRoughness: 0.6
});

// --- CHECKMARK SHAPE ---
function createCheckmarkShape() {
    const shape = new THREE.Shape();
    // Simplified checkmark coordinates
    shape.moveTo(-0.1, 0);
    shape.lineTo(-0.03, -0.07);
    shape.lineTo(0.1, 0.08);
    shape.lineTo(0.08, 0.1);
    shape.lineTo(-0.03, -0.03);
    shape.lineTo(-0.08, 0.02);
    return shape;
}

// --- CONTENT LOADING ---
const audioLoader = new THREE.AudioLoader(loadingManager);
const sfxFiles = {
    'click-1': './assets/sfx/click-1.wav',
    'click-2': './assets/sfx/click-2.wav',
    'click-3': './assets/sfx/click-3.wav',
    'tick-slow': './assets/sfx/tick-slow.mp3',
    'tick-fast': './assets/sfx/tick-fast.mp3'
};

Object.entries(sfxFiles).forEach(([name, path]) => {
    audioLoader.load(path, (buffer) => {
        state.audioBuffers[name] = buffer;
    });
});

const fontLoader = new FontLoader(loadingManager);
fontLoader.load(FONT_PATH, (font) => {
    const cardDepth = 0.04;

    // 1. "To-do" Title Text
    const titleGeometry = new TextGeometry('To-do', {
        font: font,
        size: 0.6,
        height: 0.2, // Thickness
        curveSegments: 12,
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.02,
        bevelSegments: 5
    });
    // titleGeometry.center(); // Removed center to allow manual left alignment
    const titleMaterial = new THREE.MeshStandardMaterial({ color: CONFIG.colors.todoText, roughness: 0.3, metalness: 0.1 });
    const titleMesh = new THREE.Mesh(titleGeometry, titleMaterial);
    titleMesh.position.set(-1.9, 2.7, 0); // Aligned to red line (left edge of card)
    todoGroup.add(titleMesh);

    // 2. Glass Card
    const cardWidth = 3.8;
    const cardHeight = 5.0;
    const cardShape = createRoundedRectShape(cardWidth, cardHeight, 0.2);
    const cardGeometry = new THREE.ExtrudeGeometry(cardShape, { 
        depth: cardDepth, 
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.02,
        bevelSegments: 5
    });
    cardGeometry.center();
    const cardMesh = new THREE.Mesh(cardGeometry, glassMaterial);
    cardMesh.position.set(0, 0, 0);
    todoGroup.add(cardMesh);

    // 3. List Item Group (for easier raycasting)
    const listItemGroup = new THREE.Group();
    todoGroup.add(listItemGroup);

    // 3a. Checkbox (Torus)
    const torusGeometry = new THREE.TorusGeometry(0.18, 0.03, 16, 100);
    const torusMaterial = new THREE.MeshStandardMaterial({ color: CONFIG.colors.circleStroke, roughness: 0.5, metalness: 0.0 });
    const checkboxTorus = new THREE.Mesh(torusGeometry, torusMaterial);
    checkboxTorus.position.set(-1.4, 1.6, cardDepth / 2 + 0.02);
    checkboxTorus.userData = { kind: 'todoItem' };
    listItemGroup.add(checkboxTorus);
    interactables.push(checkboxTorus);

    // 3b. Hit Area (Invisible circle to make the inside clickable)
    const hitAreaGeometry = new THREE.CircleGeometry(0.18, 32);
    const hitAreaMaterial = new THREE.MeshBasicMaterial({ 
        transparent: true, 
        opacity: 0,
        depthWrite: false 
    });
    const hitAreaMesh = new THREE.Mesh(hitAreaGeometry, hitAreaMaterial);
    hitAreaMesh.position.set(-1.4, 1.6, cardDepth / 2 + 0.021); // Slightly in front of torus
    hitAreaMesh.userData = { kind: 'todoItem' };
    listItemGroup.add(hitAreaMesh);
    interactables.push(hitAreaMesh);

    // 3c. Filler Circle (Yellow)
    const fillerGeometry = new THREE.CircleGeometry(0.18, 32);
    const fillerMaterial = new THREE.MeshStandardMaterial({ 
        color: CONFIG.colors.todoText,
        roughness: 0.5,
        metalness: 0.0,
        transparent: true,
        opacity: 0
    });
    const fillerMesh = new THREE.Mesh(fillerGeometry, fillerMaterial);
    fillerMesh.position.set(-1.4, 1.6, cardDepth / 2 + 0.025);
    fillerMesh.scale.set(0.001, 0.001, 0.001);
    listItemGroup.add(fillerMesh);

    // 3c. Checkmark (White)
    const checkmarkShape = createCheckmarkShape();
    const checkmarkGeometry = new THREE.ExtrudeGeometry(checkmarkShape, { depth: 0.02, bevelEnabled: false });
    checkmarkGeometry.center();
    const checkmarkMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xffffff,
        transparent: true,
        opacity: 0
    });
    const checkmarkMesh = new THREE.Mesh(checkmarkGeometry, checkmarkMaterial);
    checkmarkMesh.position.set(-1.4, 1.6, cardDepth / 2 + 0.03);
    checkmarkMesh.scale.set(1.5, 1.5, 1.5);
    listItemGroup.add(checkmarkMesh);

    // 4. List Item: "make art" Text
    const itemGeometry = new TextGeometry('make art', {
        font: font,
        size: 0.3,
        height: 0.05,
        curveSegments: 12
    });
    const itemMaterial = new THREE.MeshStandardMaterial({ color: CONFIG.colors.itemText });
    const itemMesh = new THREE.Mesh(itemGeometry, itemMaterial);
    itemMesh.position.set(-1.05, 1.45, cardDepth / 2 + 0.02);
    itemMesh.userData = { kind: 'todoItem' };
    listItemGroup.add(itemMesh);
    interactables.push(itemMesh);

    // Store references for animation
    state.torus = checkboxTorus;
    state.filler = fillerMesh;
    state.checkmark = checkmarkMesh;

    // --- NOT TO DO CARD ---
    const notTodoCardWidth = 3.8;
    const notTodoCardHeight = 5.0;
    const notTodoCardShape = createRoundedRectShape(notTodoCardWidth, notTodoCardHeight, 0.2);
    const notTodoCardGeometry = new THREE.ExtrudeGeometry(notTodoCardShape, {
        depth: 0.04,
        bevelEnabled: true,
        bevelThickness: 0.02,
        bevelSize: 0.02,
        bevelSegments: 4
    });
    notTodoCardGeometry.center();
    const notTodoCardMesh = new THREE.Mesh(notTodoCardGeometry, notTodoCardMaterial);
    notTodoGroup.add(notTodoCardMesh);

    // "to-do" in gray
    const notTodoTitleGeometry = new TextGeometry('To-do', {
        font: font,
        size: 0.6,
        height: 0.2,
        curveSegments: 10
    });
    const notTodoTitleMaterial = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.6 });
    const notTodoTitleMesh = new THREE.Mesh(notTodoTitleGeometry, notTodoTitleMaterial);
    notTodoTitleMesh.position.set(-1.9, 2.7, 0.04);
    notTodoGroup.add(notTodoTitleMesh);

    // Red "NOT" handwritten look (bold + tilted)
    const notTextGeometry = new TextGeometry('NOT', {
        font: font,
        size: 0.6,
        height: 0.15,
        curveSegments: 10,
        bevelEnabled: false
    });
    const notTextMaterial = new THREE.MeshStandardMaterial({ color: 0xff1a1a, roughness: 0.4 });
    const notTextMesh = new THREE.Mesh(notTextGeometry, notTextMaterial);
    notTextMesh.rotation.z = THREE.MathUtils.degToRad(15);
    notTextMesh.position.set(-2.15, 2.9, 0.3);
    notTodoGroup.add(notTextMesh);

    // Red strike line
    const strikeGeometry = new THREE.BoxGeometry(2.5, 0.05, 0.02);
    const strikeMaterial = new THREE.MeshStandardMaterial({ color: 0xff1a1a });
    const strikeMesh = new THREE.Mesh(strikeGeometry, strikeMaterial);
    strikeMesh.position.set(-0.7, 3.0, 0.25);
    strikeMesh.rotation.z = THREE.MathUtils.degToRad(15);
    notTodoGroup.add(strikeMesh);

    // NOT TO DO list items
    const listItems = [
        'doomscroll',
        'overthink',
        'quit',
        'quit',
        'quit',
        'quit',
        'quit',
    ];

    const listStartY = 1.8;
    const listGap = state.notTodoList.listGap;
    const notTodoListGroup = new THREE.Group();
    notTodoGroup.add(notTodoListGroup);
    state.notTodoList.startY = listStartY;
    state.notTodoList.listGroup = notTodoListGroup;

    const createNotTodoItem = (text, index, y, startZ = 0) => {
        const itemGroup = new THREE.Group();
        itemGroup.position.set(0, y, startZ);
        notTodoListGroup.add(itemGroup);

        // Unified Hit Area (Invisible plane covering circle and text)
        const hitAreaGeom = new THREE.PlaneGeometry(3.5, 0.6);
        const hitAreaMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
        const hitAreaMesh = new THREE.Mesh(hitAreaGeom, hitAreaMat);
        hitAreaMesh.position.set(-0.2, -0.05, 0.05);
        hitAreaMesh.userData = { kind: 'notTodoItem', index };
        itemGroup.add(hitAreaMesh);
        interactables.push(hitAreaMesh);

        const circleGeom = new THREE.TorusGeometry(0.18, 0.025, 16, 64);
        const circleMat = new THREE.MeshStandardMaterial({ color: 0x8f8f8f, roughness: 0.7, transparent: true });
        const circleMesh = new THREE.Mesh(circleGeom, circleMat);
        circleMesh.position.set(-1.4, 0, 0.04);
        itemGroup.add(circleMesh);

        const itemGeom = new TextGeometry(text, {
            font: font,
            size: 0.35,
            height: 0.03,
            curveSegments: 10
        });
        const itemMat = new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 0.6, transparent: true });
        const itemMesh = new THREE.Mesh(itemGeom, itemMat);
        itemMesh.position.set(-1.05, -0.15, 0.04);
        itemGroup.add(itemMesh);

        // X mark (two thin boxes)
        const xGroup = new THREE.Group();
        xGroup.position.set(-1.4, 0, 0.06);
        xGroup.scale.set(0.001, 0.001, 0.001);
        itemGroup.add(xGroup);

        const xMat = new THREE.MeshStandardMaterial({ color: 0xff1a1a, transparent: true, opacity: 0 });
        const xBarGeom = new THREE.BoxGeometry(0.35, 0.04, 0.02);
        const xBar1 = new THREE.Mesh(xBarGeom, xMat);
        const xBar2 = new THREE.Mesh(xBarGeom, xMat);
        xBar1.rotation.z = THREE.MathUtils.degToRad(45);
        xBar2.rotation.z = THREE.MathUtils.degToRad(-45);
        xGroup.add(xBar1, xBar2);

        state.notTodoList.items.push({
            index,
            group: itemGroup,
            xGroup,
            baseY: y,
            currentY: y,
            velocity: 0,
            progress: 0,
            ticked: false,
            removed: false,
            frozenUntil: 0,
            materials: [circleMat, itemMat],
            xMaterials: [xMat],
            spawnZ: startZ
        });
    };
    state.notTodoList.createItem = createNotTodoItem;

    listItems.forEach((text, index) => {
        const y = listStartY - index * listGap;
        createNotTodoItem(text, index, y);
    });
});

// --- CLICK HANDLER ---
function onPointerDown(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(interactables, true);

    if (intersects.length > 0) {
        // Filter out objects that belong to removed groups
        const validIntersects = intersects.filter(hit => {
            const kind = hit.object.userData?.kind;
            if (kind === 'notTodoItem') {
                const index = hit.object.userData.index;
                const item = state.notTodoList.items[index];
                return item && !item.removed && item.group.visible;
            }
            return true;
        });

        if (validIntersects.length === 0) return;

        const notTodoHit = validIntersects.find((hit) => hit.object.userData?.kind === 'notTodoItem');
        if (notTodoHit && state.mode === 'notTodo') {
            const index = notTodoHit.object.userData.index;
            const item = state.notTodoList.items[index];
            if (item && !item.ticked && !item.removed) {
                item.ticked = true;
                playClickSFX();
                
                // Increment big number
                state.notTodoCount++;
                const bigNumberEl = document.getElementById('big-number-display');
                if (bigNumberEl) {
                    bigNumberEl.innerText = state.notTodoCount.toString().padStart(2, '0');
                }

                // Obfuscate title and increment date
                if (state.notTodoCount > 4) {
                    const gothicTitleEl = document.getElementById('gothic-title-display');
                    if (gothicTitleEl) {
                        const qMarkCount = 4 + Math.floor(Math.random() * 5); // 4-8 question marks
                        gothicTitleEl.innerText = '?'.repeat(qMarkCount);
                    }
                }

                state.currentDateNum++;
                const infoDateEl = document.getElementById('info-date-display');
                if (infoDateEl) {
                    infoDateEl.innerText = `Haeun ${state.currentDateNum}`;
                }
            }
            return;
        }

        const todoHit = intersects.find((hit) => hit.object.userData?.kind === 'todoItem');
        if (todoHit && state.mode === 'todo') {
            state.isCompleted = !state.isCompleted;
            playClickSFX();
            if (state.isCompleted && !state.transitionTriggered) {
                state.transitionTriggered = true;
                state.mode = 'transition';
                state.transitionProgress = 0;
                state.cameraStartPos.copy(camera.position);
            }
        }
    }
}

window.addEventListener('pointerdown', onPointerDown);

// --- AUDIO SFX ---
function playThump() {
    // Lazy initialization of AudioContext on first play attempt
    if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    
    if (state.audioCtx.state === 'suspended') {
        state.audioCtx.resume();
    }

    const now = state.audioCtx.currentTime;
    
    // 1. HEAVY IMPACT (Sub-bass "Thump")
    const kickOsc = state.audioCtx.createOscillator();
    const kickGain = state.audioCtx.createGain();
    kickOsc.type = 'sine';
    kickOsc.frequency.setValueAtTime(60, now);
    kickOsc.frequency.exponentialRampToValueAtTime(30, now + 0.15);
    
    kickGain.gain.setValueAtTime(0, now);
    kickGain.gain.linearRampToValueAtTime(0.8, now + 0.01);
    kickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    
    kickOsc.connect(kickGain);
    kickGain.connect(state.audioCtx.destination);
    kickOsc.start(now);
    kickOsc.stop(now + 0.5);

    // 2. DARK MINOR CHORD (Somber Piano-like Chord)
    // Low Octave Cm: C1, Eb2, G2, C3, and a slightly dissonant Bb2
    const frequencies = [32.70, 77.78, 98.00, 130.81, 116.54]; 
    
    frequencies.forEach((freq, i) => {
        const osc = state.audioCtx.createOscillator();
        const gain = state.audioCtx.createGain();
        const filter = state.audioCtx.createBiquadFilter();

        // Complex tone: sine for base, triangle for some "woody" grit
        osc.type = i === 0 ? 'sine' : 'triangle'; 
        osc.frequency.setValueAtTime(freq, now);
        // Slight detune for a thicker, unsettled feel
        osc.detune.setValueAtTime((Math.random() - 0.5) * 15, now);

        // Low-pass filter for a muffled, "heavy" atmosphere
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(200, now); // Very low cutoff
        filter.Q.setValueAtTime(2, now);

        // Slow Attack, Long Boom Tail
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(i === 0 ? 0.5 : 0.2, now + 0.08); 
        gain.gain.exponentialRampToValueAtTime(0.001, now + 5.0); // Longer tail

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(state.audioCtx.destination);

        osc.start(now);
        osc.stop(now + 5.0);
    });
}

function playClickSFX() {
    if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();

    const isNotTodo = state.mode === 'notTodo';
    let bufferName = 'click-1';
    let pitch = 1.0;

    if (isNotTodo) {
        const rand = Math.floor(Math.random() * 3) + 1;
        bufferName = `click-${rand}`;
        // Random low pitch between 0.5 and 0.8
        pitch = 0.5 + Math.random() * 0.3;
    }

    const buffer = state.audioBuffers[bufferName];
    if (buffer) {
        const source = state.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = pitch;
        
        const gain = state.audioCtx.createGain();
        gain.gain.value = isNotTodo ? 0.4 : 0.6;
        
        source.connect(gain);
        gain.connect(state.audioCtx.destination);
        source.start(0);
    }
}

function playAmbientTicks() {
    if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.audioCtx.state === 'suspended') state.audioCtx.resume();

    // Start fast looping immediately
    const fastBuffer = state.audioBuffers['tick-fast'];
    if (fastBuffer) {
        const fastSource = state.audioCtx.createBufferSource();
        fastSource.buffer = fastBuffer;
        fastSource.loop = true;
        
        const fastGain = state.audioCtx.createGain();
        fastGain.gain.value = 0.2;
        
        fastSource.connect(fastGain);
        fastGain.connect(state.audioCtx.destination);
        fastSource.start(0);
        state.ambientTickSource = fastSource;
    }
}

// Removed audio-overlay listener as it's handled lazily in playThump()

// --- ANIMATION ---
function animate() {
    requestAnimationFrame(animate);

    const time = performance.now() * 0.001;

    // Completion Animation Logic
    const targetProgress = state.isCompleted ? 1 : 0;
    state.completionProgress += (targetProgress - state.completionProgress) * 0.15;

    if (state.torus) {
        state.torus.material.color.lerpColors(
            new THREE.Color(CONFIG.colors.circleStroke),
            new THREE.Color(CONFIG.colors.todoText),
            state.completionProgress
        );

        const fillerScale = 0.001 + state.completionProgress * 1;
        state.filler.scale.set(fillerScale, fillerScale, fillerScale);
        state.filler.material.opacity = state.completionProgress;

        state.checkmark.material.opacity = Math.max(0, (state.completionProgress - 0.5) * 2);
        const checkScale = Math.min(1, state.completionProgress * 2) * 1;
        state.checkmark.scale.set(checkScale, checkScale, checkScale);
    }
    
    function easeInOutCubic(x) {
        return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    }

    // --- MODE TRANSITION ---
    if (state.mode === 'transition') {
        state.transitionProgress = Math.min(1, state.transitionProgress + 0.015);
        const easedT = easeInOutCubic(state.transitionProgress);
        const spin = easedT * Math.PI * 2;

        camera.position.lerpVectors(state.cameraStartPos, CONFIG.camera.notTodoPos, easedT);
        camera.fov = THREE.MathUtils.lerp(CONFIG.camera.todoFov, CONFIG.camera.notTodoFov, easedT);
        camera.updateProjectionMatrix();
        camera.lookAt(0, 0, 0);

        if (easedT < 0.5) {
            todoGroup.visible = true;
            notTodoGroup.visible = false;
            todoGroup.rotation.y = spin;
        } else {
            todoGroup.visible = false;
            notTodoGroup.visible = true;
            notTodoGroup.rotation.y = spin;
        }

        if (state.transitionProgress >= 0.95 && !state.soundPlayed) {
            playThump();
            state.soundPlayed = true;
        }

        if (state.transitionProgress >= 1) {
            state.mode = 'notTodo';
            todoGroup.visible = false;
            notTodoGroup.visible = true;
            state.soundPlayed = false;
            playAmbientTicks();
        }
    }

    // --- NOT TO DO LIST ITEM ANIMATION ---
    if (state.mode === 'notTodo' && state.notTodoList.items.length > 0) {
        const now = performance.now();
        
        // Get only active items and sort them by their original index
        const activeItems = state.notTodoList.items
            .filter(item => !item.removed)
            .sort((a, b) => a.index - b.index);

        state.notTodoList.items.forEach((item) => {
            if (item.removed) {
                return;
            }

            // Calculate target position based on its rank among active items
            const rank = activeItems.indexOf(item);
            const targetY = state.notTodoList.startY - rank * state.notTodoList.listGap;

            // 이동 로직: shiftStartTime이 지났을 때만 움직임 시작
            if (Math.abs(item.currentY - targetY) > 0.001 && now >= item.frozenUntil) {
                // 각 아이템별 시차 적용 (위쪽 아이템부터 순차적으로)
                // Using rank instead of item.index for consistent staggering
                const itemStagger = rank * 40;
                
                if (now > state.notTodoList.shiftStartTime + itemStagger) {
                    const stiffness = 0.12;
                    const damping = 0.5;
                    const force = (targetY - item.currentY) * stiffness;
                    item.velocity = (item.velocity + force) * damping;
                    item.currentY += item.velocity;
                }
            } else {
                item.velocity = 0;
                item.currentY = targetY; // Snap to target if very close
            }
            
            item.group.position.y = item.currentY;

            // 등장 애니메이션 (뒤에서 앞으로)
            if (item.spawnZ < 0 && !item.ticked) {
                item.spawnZ += (0 - item.spawnZ) * 0.25;
                item.group.position.z = item.spawnZ;
            }

            // 체크(삭제) 애니메이션
            if (item.ticked) {
                item.progress = Math.min(1, item.progress + 0.04);
                
                const xT = Math.min(1, item.progress / 0.4);
                const xEased = 1 - Math.pow(1 - xT, 3);
                
                const circleMat = item.materials[0];
                circleMat.color.lerpColors(
                    new THREE.Color(0x8f8f8f),
                    new THREE.Color(0xff1a1a),
                    xT
                );

                const xScale = 0.001 + xEased;
                item.xGroup.scale.set(xScale, xScale, xScale);
                item.xMaterials.forEach((mat) => {
                    mat.opacity = xT;
                });

                if (item.progress > 0.4) {
                    const sinkT = (item.progress - 0.4) / 0.6;
                    const sinkEased = Math.pow(sinkT, 3);
                    const sinkZ = -0.5 * sinkEased;
                    item.group.position.z = sinkZ;

                    const fade = 1 - sinkEased;
                    item.materials.forEach((mat) => {
                        mat.opacity = fade;
                    });
                    item.xMaterials.forEach((mat) => {
                        mat.opacity = fade;
                    });
                }

                if (item.progress >= 0.98) {
                    item.removed = true;
                    item.group.visible = false;
                    
                    // Cleanup from scene and interactables
                    state.notTodoList.listGroup.remove(item.group);
                    item.group.children.forEach(child => {
                        if (child.userData?.kind === 'notTodoItem') {
                            const idx = interactables.indexOf(child);
                            if (idx > -1) interactables.splice(idx, 1);
                        }
                    });
                    
                    // [중요 수정 1] 타이밍 조절
                    // 이동은 즉시(혹은 짧은 딜레이 후) 시작
                    state.notTodoList.shiftStartTime = now + 50;
                    
                    // 생성은 이동이 얼추 끝난 후 (500ms 뒤) 시작
                    state.notTodoList.spawnQueue.push(now + 550);
                }
            }
        });

        // [중요 수정 2] 새 아이템 생성 로직 (Queue 처리)
        if (state.notTodoList.spawnQueue.length > 0) {
            // 시간이 지난 대기열 항목들 처리
            state.notTodoList.spawnQueue = state.notTodoList.spawnQueue.filter(spawnTime => {
                if (now > spawnTime) {
                    // Only spawn if we have room (less than 8 active items)
                    const currentActiveCount = state.notTodoList.items.filter(it => !it.removed).length;
                    if (currentActiveCount >= 8) {
                        return false; // Discard spawn if full
                    }

                    const lastIndex = state.notTodoList.items.length;
                    const standardBaseY = state.notTodoList.startY - lastIndex * state.notTodoList.listGap;
                    
                    state.notTodoList.createItem('quit', lastIndex, standardBaseY, -0.6);
                    
                    const newItem = state.notTodoList.items[lastIndex];
                    
                    // With rank-based system, the new item will naturally move to its rank position.
                    // To avoid a long slide from its creation baseY, we set its currentY to just below the last rank.
                    const targetRank = currentActiveCount; // It will be the nth item (0-indexed)
                    const targetY = state.notTodoList.startY - targetRank * state.notTodoList.listGap;
                    
                    newItem.currentY = targetY;
                    newItem.group.position.y = targetY;
                    newItem.frozenUntil = now;
                    
                    return false; // 처리됨 (필터에서 제외)
                }
                return true; // 아직 대기 중
            });
        }
    }

    // --- LIGHTING TRANSITION ---
    const isNotTodo = state.mode === 'notTodo' || state.mode === 'transition';
    const lightTarget = isNotTodo ? 0 : 1;
    fillLight.intensity += (lightTarget * 1.5 - fillLight.intensity) * 0.1;
    backLight.intensity += (lightTarget * 150 - backLight.intensity) * 0.1;
    topLight.intensity += (lightTarget * 5 - topLight.intensity) * 0.1;
    ambientLight.intensity += (lightTarget * 0.2 - ambientLight.intensity) * 0.1;

    if (state.mode !== 'transition') {
        const isTodo = state.mode === 'todo';
        const cameraTarget = isNotTodo ? CONFIG.camera.notTodoPos : CONFIG.camera.todoPos;
        const targetFov = isNotTodo ? CONFIG.camera.notTodoFov : CONFIG.camera.todoFov;

        camera.position.lerp(cameraTarget, 0.05);
        camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 0.05);
        camera.updateProjectionMatrix();
        camera.lookAt(0, 0, 0);
    }

    if (!state.notTodoSpot) {
        state.notTodoSpot = new THREE.SpotLight(0xffffff, 0);
        state.notTodoSpot.position.set(0, 8, 0);
        state.notTodoSpot.angle = Math.PI / 5;
        state.notTodoSpot.penumbra = 0.4;
        state.notTodoSpot.target = notTodoGroup;
        scene.add(state.notTodoSpot);
    }
    state.notTodoSpot.intensity += ((isNotTodo ? 20 : 0) - state.notTodoSpot.intensity) * 0.1;

    const bgTarget = isNotTodo ? 0x050505 : CONFIG.colors.background;
    const currentBg = scene.background;
    if (currentBg && currentBg.isColor) {
        currentBg.lerp(new THREE.Color(bgTarget), 0.05);
    }

    const floatY = Math.sin(time * 0.8) * 0.2;
    const floatX = Math.cos(time * 0.3) * 0.05;
    if (state.mode === 'todo') {
        todoGroup.position.y = floatY;
        todoGroup.rotation.y += (Math.sin(time * 0.5) * 0.1 - todoGroup.rotation.y) * 0.05;
        todoGroup.rotation.x = floatX;
    } else if (state.mode === 'notTodo') {
        notTodoGroup.position.y = floatY * 0.4;
        notTodoGroup.rotation.x = floatX * 0.4;
    }

    // --- PROGRESS BAR ANIMATION (Moved here for speed) ---
    const progressEl = document.querySelector('.progress-bar');
    if (progressEl) {
        const totalChars = 25;
        let progressValue;
        
        const isNotTodo = state.mode === 'notTodo' || state.mode === 'transition';
        
        if (isNotTodo) {
            // not todo version: 랜덤 길이로 "점프" (불규칙)
            const nowMs = performance.now();
            if (nowMs >= state.progressJumpNextTime) {
                state.progressJumpValue = Math.random();
                const minDelay = 140;
                const maxDelay = 260;
                state.progressJumpNextTime = nowMs + minDelay + Math.random() * (maxDelay - minDelay);
            }
            progressValue = state.progressJumpValue;
        } else {
            // todo version: 실제 진행률
            progressValue = state.completionProgress;
        }

        const filledChars = Math.round(progressValue * totalChars);
        const bar = '[' + '-'.repeat(filledChars) + ' '.repeat(totalChars - filledChars) + ']';
        progressEl.innerText = bar;
    }

    controls.update();
    renderer.render(scene, camera);
}

// --- GIBBERISH TEXT ANIMATION ---
const GIBBERISH_CHARS = '!@#$%^&*()_+{}:"<>?,./;\'[]\\=-';
const GIBBERISH_ELEMENTS = [
    { id: 'gibberish-text-1', original: 'good morning,' },
    { id: 'gibberish-text-2', original: 'here are your priorities for today.' }
];

function scrambleText(text, intensity = 0.2) {
    if (intensity === 0) return text;
    return text.split('').map(char => {
        if (char === ' ' || char === ',') return char;
        return Math.random() < intensity 
            ? GIBBERISH_CHARS[Math.floor(Math.random() * GIBBERISH_CHARS.length)] 
            : char;
    }).join('');
}

// Initial Call to set correct state immediately
updateUIOverlay();

function updateUIOverlay() {
    const isNotTodo = state.mode === 'notTodo' || state.mode === 'transition';
    const body = document.body;
    const root = document.documentElement;
    
    if (isNotTodo) {
        body.classList.add('mode-not-todo');
    } else {
        body.classList.remove('mode-not-todo');
    }
    
    // Update CRT effect intensities via CSS custom properties
    root.style.setProperty('--scanline-opacity', isNotTodo ? '0.45' : '0');
    root.style.setProperty('--vignette-opacity', isNotTodo ? '0.8' : '0');
    root.style.setProperty('--noise-opacity', '0'); // Fully removed
    
    const textColor = isNotTodo ? '#ff3333' : '#444444';
    const intensity = isNotTodo ? 0.3 : 0; // todo 버전에서는 intensity 0

    // Update gibberish text
    GIBBERISH_ELEMENTS.forEach(item => {
        const el = document.getElementById(item.id);
        if (el) {
            el.style.color = isNotTodo ? '#ff3333' : '#444444'; // gibberish text color
            el.innerText = scrambleText(item.original, intensity);
        }
    });

    // Update elements with .red-text class
    const redTextElements = document.querySelectorAll('.red-text, .bottom-left-logs');
    redTextElements.forEach(el => {
        // Class-based styling handles color, but force inline update if needed or rely on class
        el.style.color = isNotTodo ? '#ff3333' : '#444444';
    });

    // Update status text content
    const statusTextEl = document.getElementById('status-mode-text');
    if (statusTextEl) {
        statusTextEl.innerText = isNotTodo ? 'restriction mode activated' : 'all systems nominal';
    }
}

setInterval(updateUIOverlay, 800);

// --- SYSTEM LOGS ANIMATION ---
const LOG_MESSAGES = [
    "CORE STATUS: STABLE",
    "SECTOR 7G SEARCHING...",
    "INPUT BUFFER SYNCED",
    "MEMORY PARITY: OK",
    "UPLINK ESTABLISHED",
    "BYPASSING SECURITY...",
    "NODE 03 ACTIVE",
    "DAMPENING FIELD: 100%",
    "ENCRYPTION KEY: VALID",
    "LATENCY: 12MS"
];

const NOT_TODO_LOG_MESSAGES = [
    "QUIT", "QUIT", "QUIT", "QUIT", "QUIT",
    "QUIT?", "QUIT?",
    "COME ON", "DON'T STOP", "I KNOW YOU WANT TO",
    "CRITICAL ERROR: ACCESS DENIED",
    "RESTRICTION MODE ACTIVE",
    "SYSTEM CORRUPTION DETECTED",
    "FATAL EXCEPTION AT 0x004F",
    "WARNING: CORE TEMPERATURE RISING",
    "EMERGENCY PROTOCOL ACTIVATED"
];

function updateLogs() {
    const logContainer = document.querySelector('.bottom-left-logs');
    if (!logContainer) return;

    const isNotTodo = state.mode === 'notTodo' || state.mode === 'transition';
    const messages = isNotTodo ? NOT_TODO_LOG_MESSAGES : LOG_MESSAGES;
    const randomMsg = messages[Math.floor(Math.random() * messages.length)];
    
    const logLine = document.createElement('div');
    logLine.className = 'log-line';
    logLine.innerText = `> ${randomMsg}`;
    
    logContainer.appendChild(logLine);
    
    // Keep only last 6 lines
    while (logContainer.children.length > 6) {
        logContainer.removeChild(logContainer.firstChild);
    }
}

// Dynamic Log Interval
function scheduleNextLog() {
    const isNotTodo = state.mode === 'notTodo' || state.mode === 'transition';
    const interval = isNotTodo ? 600 : 1200;
    
    setTimeout(() => {
        updateLogs();
        scheduleNextLog();
    }, interval);
}

scheduleNextLog();

animate();
