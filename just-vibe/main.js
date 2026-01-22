import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- CONFIGURATION ---
const CONFIG = {
    card: {
        width: 3.5,
        height: 5,
        depth: 0.01,
        radius: 0.2
    },
    colors: {
        background: 0x050505,
        base: 0x0a0a0a,
        hologram: 0x00ffff
    },
    bloom: {
        strength: 0.1,
        radius: 0.2,
        threshold: 0.05
    },
    objects: [
        './assets/object/Meshy_AI_Chess_Pawn_0122073850_texture.glb',
        './assets/object/Meshy_AI_Whimsical_Silence_0122052100_texture.glb'
    ]
};
const HDRI_PATH = './assets/studio.hdr';

// --- SCENE SETUP ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 10;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ReinhardToneMapping;
renderer.toneMappingExposure = 1.25;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// --- ENVIRONMENT (HDRI) ---
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

new RGBELoader()
    .load(HDRI_PATH, (texture) => {
        const envMap = pmremGenerator.fromEquirectangular(texture).texture;
        scene.environment = envMap;
        texture.dispose();
        pmremGenerator.dispose();
    });

// --- POST PROCESSING ---
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    CONFIG.bloom.strength,
    CONFIG.bloom.radius,
    CONFIG.bloom.threshold
);
composer.addPass(bloomPass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

// --- LIGHTING ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const pointLight = new THREE.PointLight(0xffffff, 1.5);
pointLight.position.set(5, 5, 5);
scene.add(pointLight);

// --- HOLOGRAPHIC MATERIAL (PHYSICAL IRIDESCENCE) ---
const hologramMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0xffffff),
    metalness: 1.0,
    roughness: 0.12,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    iridescence: 1.0,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [150, 1200],
    envMapIntensity: 1.8,
    sheen: 0.6,
    sheenRoughness: 0.4
});
const microNormalMap = new THREE.TextureLoader().load(
    'https://threejs.org/examples/textures/water/Water_1_M_Normal.jpg',
    (texture) => {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(4, 6);
        hologramMaterial.normalMap = texture;
        hologramMaterial.normalScale = new THREE.Vector2(0.08, 0.08);
        hologramMaterial.needsUpdate = true;
    }
);

// --- INITIALIZE INTERACTIVE OBJECTS ---
const interactiveObjects = [];
let currentIndex = 0;
let activeObject = null;

const gltfLoader = new GLTFLoader();

// Helper: Apply holographic material to all meshes in a group/scene
function applyHoloMaterial(obj) {
    obj.traverse((child) => {
        if (child.isMesh) {
            child.material = hologramMaterial;
        }
    });
}

// 1. Create Card (the initial object)
const cardGeometry = new THREE.BoxGeometry(CONFIG.card.width, CONFIG.card.height, CONFIG.card.depth, 40, 60, 4);
const positionAttr = cardGeometry.attributes.position;
const tempVec = new THREE.Vector3();
const crumpleStrength = 0.03;
for (let i = 0; i < positionAttr.count; i += 1) {
    tempVec.fromBufferAttribute(positionAttr, i);
    const nx = Math.sin(tempVec.y * 3.1 + tempVec.z * 2.7) * 0.5;
    const ny = Math.sin(tempVec.x * 2.9 + tempVec.z * 3.4) * 0.5;
    const nz = Math.sin(tempVec.x * 2.2 + tempVec.y * 3.7) * 0.5;
    tempVec.x += nx * crumpleStrength;
    tempVec.y += ny * crumpleStrength;
    tempVec.z += nz * crumpleStrength;
    positionAttr.setXYZ(i, tempVec.x, tempVec.y, tempVec.z);
}
cardGeometry.computeVertexNormals();

// Multi-material for card (we'll just use holo for all if it's simplified, but user asked for previous material)
// Let's stick to the multi-material for the card as defined before.
const cardMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x111111 }), // sides
    new THREE.MeshStandardMaterial({ color: 0x111111 }),
    new THREE.MeshStandardMaterial({ color: 0x111111 }),
    new THREE.MeshStandardMaterial({ color: 0x111111 }),
    hologramMaterial,                                   // front
    new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.1, metalness: 0.5 }) // back
];
const cardMesh = new THREE.Mesh(cardGeometry, cardMaterials);
cardMesh.rotation.y = Math.PI + 0.5;
interactiveObjects.push(cardMesh);
activeObject = cardMesh;
scene.add(activeObject);

// 2. Load other objects
CONFIG.objects.forEach((path, index) => {
    gltfLoader.load(path, (gltf) => {
        const model = gltf.scene;
        applyHoloMaterial(model);
        
        // Center and scale model
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 5 / maxDim; // scale to match card height
        model.scale.set(scale, scale, scale);
        
        // Center geometry
        box.setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        
        // Create a wrapper group to handle rotation/position consistently
        const group = new THREE.Group();
        group.add(model);
        group.rotation.y = Math.PI + 0.5;
        
        interactiveObjects[index + 1] = group;
    });
});

// --- TEXT PLANES ---
function createTextPlane(text, size = 512) {
    const canvas = document.createElement('canvas');
    canvas.width = size * 4;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    // Clear background
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Set font style
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `200px "Manufacturing Consent"`;
    
    // Draw text
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    
    const geometry = new THREE.PlaneGeometry(canvas.width / 100, canvas.height / 100);
    return new THREE.Mesh(geometry, material);
}

// Wait for fonts to load before creating text planes
document.fonts.ready.then(() => {
    const topText = createTextPlane("no idea");
    topText.position.set(0, 3.5, -2);
    scene.add(topText);
    
    const bottomText = createTextPlane("just vibe");
    bottomText.position.set(0, -1.8, 2);
    scene.add(bottomText);
});

// --- PARTICLE NETWORK SYSTEM ---
const particleCount = 70;
const particlePositions = new Float32Array(particleCount * 3);
const particleBasePositions = [];
const particleVelocities = [];

for (let i = 0; i < particleCount; i++) {
    const x = (Math.random() - 0.5) * 18;
    const y = (Math.random() - 0.5) * 14;
    const z = (Math.random() - 0.5) * 12 - 2; // Spread around and behind card
    
    particlePositions[i * 3] = x;
    particlePositions[i * 3 + 1] = y;
    particlePositions[i * 3 + 2] = z;
    
    particleBasePositions.push({ x, y, z });
    particleVelocities.push({
        x: (Math.random() - 0.5) * 0.005,
        y: (Math.random() - 0.5) * 0.005,
        z: (Math.random() - 0.5) * 0.002,
        phase: Math.random() * Math.PI * 2
    });
}

const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

const particleMaterial = new THREE.PointsMaterial({
    color: 0x00ffff,
    size: 0.06,
    transparent: true,
    opacity: 0.7,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true
});

const particles = new THREE.Points(particleGeometry, particleMaterial);
scene.add(particles);

// --- INVERT CURSOR ---
const cursorEl = document.getElementById('invert-cursor');
const cursorSmallEl = document.getElementById('invert-cursor-small');
const overlayEl = document.getElementById('invert-overlay');
const cursorPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let cursorAnimating = false;
let isInverted = false;

function setCursorPosition(x, y) {
    cursorPos.x = x;
    cursorPos.y = y;
    if (cursorSmallEl) {
        cursorSmallEl.style.left = `${x}px`;
        cursorSmallEl.style.top = `${y}px`;
    }
}

window.addEventListener('pointermove', (event) => {
    setCursorPosition(event.clientX, event.clientY);
});

function expandRing(ringEl, onComplete) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const x = cursorPos.x;
    const y = cursorPos.y;

    // Calculate distance from click to all four corners to ensure 100% coverage
    const dists = [
        Math.sqrt(x * x + y * y),                   // Top-left
        Math.sqrt((W - x) ** 2 + y * y),            // Top-right
        Math.sqrt(x * x + (H - y) ** 2),            // Bottom-left
        Math.sqrt((W - x) ** 2 + (H - y) ** 2)      // Bottom-right
    ];
    const maxDist = Math.max(...dists);
    // Cursor is 40px diameter (20px radius). Scale covers maxDist + margin.
    const targetScale = (maxDist / 20) * 1.2;

    ringEl.style.left = `${x}px`;
    ringEl.style.top = `${y}px`;
    ringEl.style.opacity = '1';
    ringEl.style.transition = 'none';
    ringEl.style.transform = 'translate(-50%, -50%) scale(1)';
    requestAnimationFrame(() => {
        ringEl.style.transition = 'transform 0.8s ease-out';
        ringEl.style.transform = `translate(-50%, -50%) scale(${targetScale})`;
    });
    setTimeout(onComplete, 800);
}

window.addEventListener('click', () => {
    if (!cursorEl || cursorAnimating) return;
    cursorAnimating = true;

    // Switch Object
    if (interactiveObjects.length > 1) {
        scene.remove(activeObject);
        currentIndex = (currentIndex + 1) % 3;
        // In case they haven't all loaded yet, loop back to start if missing
        activeObject = interactiveObjects[currentIndex] || interactiveObjects[0];
        if (activeObject === interactiveObjects[0]) currentIndex = 0;
        scene.add(activeObject);

        // Update Title
        if (titleEl) {
            if (currentIndex !== 2) {
                titleEl.textContent = titles[currentIndex];
            }
        }
    }

    if (!isInverted) {
        expandRing(cursorEl, () => {
            isInverted = true;
            if (overlayEl) overlayEl.style.opacity = '1';
            cursorEl.style.opacity = '0'; // Hide the ring once overlay takes over
            cursorAnimating = false;
        });
    } else {
        const tempRing = document.createElement('div');
        tempRing.className = 'invert-cursor-ring';
        document.body.appendChild(tempRing);
        expandRing(tempRing, () => {
            isInverted = false;
            if (overlayEl) overlayEl.style.opacity = '0';
            tempRing.remove();
            cursorAnimating = false;
        });
    }
});

// --- INTERACTION (DRAG TO ROTATE) ---
const isDragging = { value: false };
const lastPointer = new THREE.Vector2();
const dragVelocity = new THREE.Vector2();
const dragSensitivity = 0.008;

// --- DYNAMIC TITLES ---
const titles = ['CARD', 'PAWN', 'GIBBERISH'];
const titleEl = document.getElementById('main-title');
const gibberishChars = '@#E@#$$!@#$';

function generateGibberish(length) {
    let result = '';
    for (let i = 0; i < length; i++) {
        result += gibberishChars.charAt(Math.floor(Math.random() * gibberishChars.length));
    }
    return result;
}

renderer.domElement.addEventListener('pointerdown', (event) => {
    isDragging.value = true;
    lastPointer.set(event.clientX, event.clientY);
    dragVelocity.set(0, 0);
    renderer.domElement.setPointerCapture(event.pointerId);
});

renderer.domElement.addEventListener('pointermove', (event) => {
    if (!isDragging.value) return;
    const dx = event.clientX - lastPointer.x;
    const dy = event.clientY - lastPointer.y;
    lastPointer.set(event.clientX, event.clientY);

    // Update velocity instead of direct rotation
    dragVelocity.x += dx * dragSensitivity * 0.2;
    dragVelocity.y += dy * dragSensitivity * 0.2;
});

window.addEventListener('pointerup', (event) => {
    isDragging.value = false;
    renderer.domElement.releasePointerCapture(event.pointerId);
});

// --- FRAME COUNTER FOR SCI-FI UI ---
let frameCount = 0;
const frameCounterEl = document.getElementById('frame-counter');

// --- ANIMATION LOOP ---
function animate() {
    requestAnimationFrame(animate);
    
    const t = performance.now() * 0.001;
    
    // Update frame counter
    frameCount++;
    if (frameCounterEl && frameCount % 3 === 0) {
        frameCounterEl.textContent = String(frameCount % 10000).padStart(4, '0');
    }

    // Gibberish Title Effect
    if (currentIndex === 2 && titleEl && frameCount % 5 === 0) {
        titleEl.textContent = generateGibberish(titles[2].length );
    }
    
    // Always apply velocity for continuous rotation
    if (activeObject) {
        activeObject.rotation.y += dragVelocity.x;
        activeObject.rotation.x += dragVelocity.y;
    }

    if (!isDragging.value) {
        // Apply inertia when not dragging
        dragVelocity.multiplyScalar(0.95);
    } else {
        // Slight friction while dragging to allow speed control
        dragVelocity.multiplyScalar(0.9);
    }
    
    // Subtle idle bounce
    if (activeObject) {
        activeObject.position.y = Math.sin(t * 1.5) * 0.1;
    }

    if (hologramMaterial.normalMap) {
        hologramMaterial.normalMap.offset.x = (t * 0.02) % 1;
        hologramMaterial.normalMap.offset.y = (t * 0.015) % 1;
    }
    
    // Animate particles with floating motion
    const positions = particles.geometry.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
        const base = particleBasePositions[i];
        const vel = particleVelocities[i];
        
        positions[i * 3] = base.x + Math.sin(t * 0.5 + vel.phase) * 0.3;
        positions[i * 3 + 1] = base.y + Math.cos(t * 0.4 + vel.phase * 1.3) * 0.3;
        positions[i * 3 + 2] = base.z + Math.sin(t * 0.3 + vel.phase * 0.7) * 0.15;
    }
    particles.geometry.attributes.position.needsUpdate = true;
    
    composer.render();
}

// --- RESIZE HANDLER ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
});

animate();
