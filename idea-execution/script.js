/**
 * "No Time Between IDEA and EXECUTION"
 * Three.js Implementation - Real 3D Cards
 */

import * as THREE from 'three';

// =============================================================================
// CONFIGURATION
// =============================================================================
const CONFIG = {
    TOTAL_IMAGE_SETS: 6,
    FLIP_DURATION: 0.4,        // seconds
    STAGGER_DELAY: 0.3,        // seconds
    REVEAL_STAY_TIME: 1.0,     // seconds
    SLIDE_DURATION: 0.6,       // seconds
    Z_DROP_START: 3.0,         // start closer to camera (large)
    Z_DROP_DURATION: 0.5,      // fast drop
    Z_DROP_BOUNCE: 0.15,       // small overshoot
    REPLACEMENT_STAGGER: 0.15, // seconds between the two new cards
    
    // Card dimensions (aspect ratio 9.86 : 16.69)
    CARD_WIDTH: 1.5,
    CARD_HEIGHT: 1.5 * (16.69 / 9.86),
    CARD_DEPTH: 0.02,
    
    // Grid layout
    GRID_COLS: 4,
    GRID_ROWS: 2,
    CARD_GAP: 0.4,
    CORNER_RADIUS: 0.08,
    
    // Hover tilt (in radians)
    MAX_TILT: 0.2,             // Maximum tilt angle (~11 degrees)
    HOVER_SCALE: 1.05,
    TILT_SMOOTHING: 0.15,      // Smoothing factor for tilt interpolation
    
    // Colors
    BACKGROUND_COLOR: 0x04070b,
    BACKGROUND_COLORS_BY_SET: [
        '#11263d',
        '#640804',
        '#ca9652',
        '#5a8d56',
        '#df8f9c',
        '#e33154',
    ],
    BACKGROUND_TRANSITION_DURATION: 0.3,
    EDGE_COLOR: 0x222529,

    // Sound counts
    TURNOVER_SOUND_COUNT: 4,
    PLACE_SOUND_COUNT: 10,
    HOVER_SOUND_COUNT: 1,
    HOVER_PITCH_RANGE: { min: 1.5, max: 3 },
    PLACE_SOUND_VOLUME: 0.7,

    // Intro
    INTRO_OFFSET: 0.3,
    INTRO_STAGGER: 0.2,
    INTRO_FADE_DURATION: 1,
    INTRO_CLICK_SOUND: 'ding-1.wav',
    SLIDE_PITCH_RANGE: { min: 0.8, max: 1.5 },
};

// =============================================================================
// STATE
// =============================================================================
let scene, camera, renderer, raycaster, mouse;
let cards = [];
let availableSets = [];
let lastShownSet = -1;
const slotStates = new Array(8).fill('available');
let hoveredCard = null;
let showIntro = true;
let introCard = null;
let isIntroSequence = false;
const cacheBuster = Date.now();
const backgroundTransition = {
    isActive: false,
    startColor: new THREE.Color(),
    targetColor: new THREE.Color(),
    startTime: 0,
    duration: CONFIG.BACKGROUND_TRANSITION_DURATION,
};

// =============================================================================
// EASING FUNCTIONS
// =============================================================================
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeInCubic = (t) => t * t * t;

// =============================================================================
// SOUND MANAGER
// =============================================================================
const SoundManager = {
    turnOverSounds: [],
    placeSounds: [],
    hoverSounds: [],
    slideSound: null,
    introClickSound: null,
    lastTurnOverIndex: -1,
    lastPlaceIndex: -1,
    lastHoverIndex: -1,
    
    init() {
        // Load turnOver sounds
        for (let i = 1; i <= CONFIG.TURNOVER_SOUND_COUNT; i++) {
            this.turnOverSounds.push(new Audio(`sfx/turnOver-${i}.wav?v=${cacheBuster}`));
        }
        // Load place sounds
        for (let i = 1; i <= CONFIG.PLACE_SOUND_COUNT; i++) {
            const sound = new Audio(`sfx/place-${i}.wav?v=${cacheBuster}`);
            sound.preload = 'auto';
            sound.load();
            this.placeSounds.push(sound);
        }
        // Load hover sounds
        for (let i = 1; i <= CONFIG.HOVER_SOUND_COUNT; i++) {
            this.hoverSounds.push(new Audio(`sfx/hover-${i}.wav?v=${cacheBuster}`));
        }
        this.introClickSound = new Audio(`sfx/${CONFIG.INTRO_CLICK_SOUND}?v=${cacheBuster}`);
        this.introClickSound.preload = 'auto';
        this.introClickSound.load();
        
        this.slideSound = new Audio(`sfx/slide-1.wav?v=${cacheBuster}`);
        this.slideSound.preload = 'auto';
        this.slideSound.load();
    },
    
    playRandomTurnOver() {
        // Pick random index, avoiding the last played
        let index;
        do {
            index = Math.floor(Math.random() * this.turnOverSounds.length);
        } while (index === this.lastTurnOverIndex && this.turnOverSounds.length > 1);
        
        this.lastTurnOverIndex = index;
        const sound = this.turnOverSounds[index].cloneNode();
        sound.play();
    },
    
    playRandomPlace() {
        // Pick random index, avoiding the last played
        let index;
        do {
            index = Math.floor(Math.random() * this.placeSounds.length);
        } while (index === this.lastPlaceIndex && this.placeSounds.length > 1);
        
        this.lastPlaceIndex = index;
        const sound = this.placeSounds[index].cloneNode();
        sound.volume = CONFIG.PLACE_SOUND_VOLUME;
        sound.play();
    },

    playRandomHover() {
        // Pick random index, avoiding the last played
        let index;
        do {
            index = Math.floor(Math.random() * this.hoverSounds.length);
        } while (index === this.lastHoverIndex && this.hoverSounds.length > 1);
        
        this.lastHoverIndex = index;
        const sound = this.hoverSounds[index].cloneNode();
        
        // Disable pitch preservation to allow playbackRate to shift the pitch
        sound.preservesPitch = false;
        sound.mozPreservesPitch = false;
        sound.webkitPreservesPitch = false;
        
        // Apply random pitch (playbackRate)
        const { min, max } = CONFIG.HOVER_PITCH_RANGE;
        const randomPitch = min + Math.random() * (max - min);
        sound.playbackRate = randomPitch;
        
        sound.play();
    },

    playIntroClick() {
        if (!this.introClickSound) return;
        const sound = this.introClickSound.cloneNode();
        sound.play();
    },

    playSlide() {
        if (!this.slideSound) return;
        const sound = this.slideSound.cloneNode();
        
        // Disable pitch preservation
        sound.preservesPitch = false;
        sound.mozPreservesPitch = false;
        sound.webkitPreservesPitch = false;
        
        // Apply random pitch
        const { min, max } = CONFIG.SLIDE_PITCH_RANGE;
        const randomPitch = min + Math.random() * (max - min);
        sound.playbackRate = randomPitch;
        
        sound.play();
    }
};

let isAudioUnlocked = false;

function unlockAudioOnce() {
    if (isAudioUnlocked) return;
    isAudioUnlocked = true;

    const sound = SoundManager.hoverSounds[0]
        ? SoundManager.hoverSounds[0].cloneNode()
        : new Audio();
    sound.muted = true;

    const playPromise = sound.play();
    if (playPromise && typeof playPromise.then === 'function') {
        playPromise
            .then(() => {
                sound.pause();
                sound.currentTime = 0;
                sound.muted = false;
            })
            .catch(() => {
                isAudioUnlocked = false;
                sound.muted = false;
            });
    } else {
        sound.pause();
        sound.currentTime = 0;
        sound.muted = false;
    }
}

function hideCardsForIntro() {
    slotStates.fill('busy');
    hoveredCard = null;

    cards.forEach(card => {
        card.state = 'busy';
        card.setOpacity(0);
        card.group.visible = false;
        card.isHovered = false;
    });
}

function startIntroPlacement() {
    showIntro = false;

    setTimeout(() => {
        unlockAudioOnce();
    }, 0);

    // Let browser paint the fade, then start card drops
    requestAnimationFrame(() => {
        let slidesInComplete = 0;
        const onSlideInComplete = () => {
            slidesInComplete += 1;
            if (slidesInComplete === cards.length) {
                slotStates.fill('available');
                cards.forEach(card => {
                    card.state = 'available';
                });
            }
        };

        cards.forEach((card, index) => {
            card.group.visible = true;
            card.setOpacity(0);
            card.state = 'busy';

            const offset = index % 2 === 0 ? CONFIG.INTRO_OFFSET : -CONFIG.INTRO_OFFSET;
            
            // Move to start position immediately to fix shadow issue
            const startZ = card.basePosition.z + offset + CONFIG.Z_DROP_START;
            card.currentPosition.z = startZ;
            card.group.position.z = startZ;
            card.group.updateMatrixWorld(true);

            if (index === 0) {
                introDropInNoBounce(card, offset, onSlideInComplete);
                return;
            }

            const delay = index * CONFIG.INTRO_STAGGER * 1000;
            setTimeout(() => {
                introDropInNoBounce(card, offset, onSlideInComplete);
            }, delay);
        });
    });
}

function introDropInNoBounce(card, zOffset, onComplete) {
    card.isSliding = true;
    SoundManager.playRandomPlace();
    const finalTargetZ = card.basePosition.z;
    const startZ = finalTargetZ + zOffset + CONFIG.Z_DROP_START;

    card.currentPosition.y = card.basePosition.y;
    card.currentPosition.z = startZ;
    card.group.position.set(card.currentPosition.x, card.currentPosition.y, card.currentPosition.z);
    card.group.updateMatrixWorld(true);

    card.setOpacity(0);
    card.animate('opacity', 0, 1, CONFIG.Z_DROP_DURATION, easeOutCubic);
    card.animate('positionZ', startZ, finalTargetZ, CONFIG.Z_DROP_DURATION, easeOutCubic, () => {
        card.isSliding = false;
        if (onComplete) onComplete();
    });
}

// =============================================================================
// TEXTURE LOADER
// =============================================================================
const textureLoader = new THREE.TextureLoader();
const textureCache = new Map();

function loadTexture(path, isDataTexture = false) {
    if (textureCache.has(path)) {
        return Promise.resolve(textureCache.get(path));
    }
    return new Promise((resolve, reject) => {
        textureLoader.load(
            `${path}?v=${cacheBuster}`,
            (texture) => {
                if (isDataTexture) {
                    texture.colorSpace = THREE.NoColorSpace;
                } else {
                    texture.colorSpace = THREE.SRGBColorSpace;
                }
                textureCache.set(path, texture);
                resolve(texture);
            },
            undefined,
            (error) => {
                console.error(`Failed to load texture: ${path}`, error);
                reject(error);
            }
        );
    });
}

// =============================================================================
// CARD CLASS
// =============================================================================
class Card {
    constructor(index) {
        this.index = index;
        this.state = 'available';
        this.isFlipped = false;
        this.isHovered = false;
        this.targetRotation = { x: 0, y: 0 };
        this.currentRotation = { x: 0, y: 0 };
        this.hoverTiltTarget = { x: 0, y: 0 };  // Target tilt based on cursor
        this.tiltOffset = { x: 0, y: 0 };      // Current interpolated tilt offset
        this.baseRotationY = 0;                 // Base Y rotation (0 = unflipped, Math.PI = flipped)
        this.isSliding = false;                 // Flag to prevent hover during slide animations
        this.targetPosition = { x: 0, y: 0, z: 0 };
        this.currentPosition = { x: 0, y: 0, z: 0 };
        this.targetScale = 1;
        this.currentScale = 1;
        this.currentOpacity = 0;
        this.basePosition = { x: 0, y: 0, z: 0 };
        this.animations = [];
        
        this.group = new THREE.Group();
        // Note: createMesh() is called separately via init()
    }
    
    async init() {
        await this.createMesh();
        return this;
    }
    
    async createMesh() {
        const { CARD_WIDTH, CARD_HEIGHT, CARD_DEPTH, CORNER_RADIUS } = CONFIG;
        const COVER_BLEED = 0.03;
        const WIDTH_WITH_BLEED = CARD_WIDTH + COVER_BLEED;
        const HEIGHT_WITH_BLEED = CARD_HEIGHT + COVER_BLEED;
        
        // Load back texture (card back cover - shown when not flipped)
        // Uses specific back-normal and back-roughness for high detail on the cover
        const backTexture = await loadTexture('images/back.png');
        const backNormalMap = await loadTexture('images/normal/back-normal.png', true);
        const backRoughnessMap = await loadTexture('images/roughness/back-roughness.png', true);
        
        // Front face material (physically represents the "back cover" of the card)
        this.frontMaterial = new THREE.MeshPhysicalMaterial({
            map: backTexture,
            normalMap: backNormalMap,
            roughnessMap: backRoughnessMap,
            normalScale: new THREE.Vector2(1, 1),
            side: THREE.FrontSide,
            transparent: true,
            roughness: 1.0, // Full map control for roughness
            metalness: 0.1,
            clearcoat: 0.2, // Reduced to expose roughness effect
            clearcoatRoughness: 0.1,
        });
        
        // Back face material (physically represents the "front face" with IDEA/EXECUTION)
        // Initially set to a dark color until setFaceTexture is called
        this.backMaterial = new THREE.MeshPhysicalMaterial({
            color: 0x1a1a2e,
            side: THREE.FrontSide,
            transparent: true,
            roughness: 1.0, // Full map control for roughness
            metalness: 0.1,
            clearcoat: 0.2, // Reduced to expose roughness effect
            clearcoatRoughness: 0.1,
        });
        
        // Small offset to prevent Z-fighting with the edge ExtrudeGeometry
        const Z_OFFSET = 0.002;

        // Helper: rounded rectangle shape
        const createRoundedRectShape = (w, h, r) => {
            const shape = new THREE.Shape();
            const x = -w / 2;
            const y = -h / 2;
            const radius = Math.min(r, w / 2, h / 2);
            shape.moveTo(x + radius, y);
            shape.lineTo(x + w - radius, y);
            shape.quadraticCurveTo(x + w, y, x + w, y + radius);
            shape.lineTo(x + w, y + h - radius);
            shape.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
            shape.lineTo(x + radius, y + h);
            shape.quadraticCurveTo(x, y + h, x, y + h - radius);
            shape.lineTo(x, y + radius);
            shape.quadraticCurveTo(x, y, x + radius, y);
            return shape;
        };

        const roundedShape = createRoundedRectShape(WIDTH_WITH_BLEED, HEIGHT_WITH_BLEED, CORNER_RADIUS);

        const applyBoxUVs = (geometry) => {
            geometry.computeBoundingBox();
            const { min, max } = geometry.boundingBox;
            const rangeX = max.x - min.x || 1;
            const rangeY = max.y - min.y || 1;
            const pos = geometry.attributes.position;
            const uv = geometry.attributes.uv;
            for (let i = 0; i < uv.count; i++) {
                const x = pos.getX(i);
                const y = pos.getY(i);
                uv.setXY(i, (x - min.x) / rangeX, (y - min.y) / rangeY);
            }
            uv.needsUpdate = true;
        };

        // Create front plane (visible when not flipped, Z+)
        const frontGeometry = new THREE.ShapeGeometry(roundedShape);
        applyBoxUVs(frontGeometry);
        frontGeometry.computeTangents(); // Compute tangents for normal mapping
        this.frontMesh = new THREE.Mesh(frontGeometry, this.frontMaterial);
        this.frontMesh.position.z = CARD_DEPTH / 2 + Z_OFFSET;
        
        // Create back plane (visible when flipped, Z-, rotated 180deg)
        const backGeometry = new THREE.ShapeGeometry(roundedShape);
        applyBoxUVs(backGeometry);
        backGeometry.computeTangents(); // Compute tangents for normal mapping
        this.backMesh = new THREE.Mesh(backGeometry, this.backMaterial);
        this.backMesh.position.z = -CARD_DEPTH / 2 - Z_OFFSET;
        this.backMesh.rotation.y = Math.PI;
        
        // Create edge (rounded extrude for card thickness)
        const edgeGeometry = new THREE.ExtrudeGeometry(roundedShape, {
            depth: CARD_DEPTH,
            bevelEnabled: false,
            curveSegments: 8,
        });
        this.edgeMaterial = new THREE.MeshStandardMaterial({ color: CONFIG.EDGE_COLOR, transparent: true });
        this.edgeMesh = new THREE.Mesh(edgeGeometry, this.edgeMaterial);
        this.edgeMesh.position.z = -CARD_DEPTH / 2;
        
        // Add to group
        this.group.add(this.frontMesh);
        this.group.add(this.backMesh);
        this.group.add(this.edgeMesh);
        
        // Shadow casting
        this.frontMesh.castShadow = true;
        this.backMesh.castShadow = true;
        this.edgeMesh.castShadow = true;
        this.frontMesh.receiveShadow = true;
        this.backMesh.receiveShadow = true;
        
        // Store reference for raycasting
        this.frontMesh.userData.card = this;
        this.backMesh.userData.card = this;
        this.edgeMesh.userData.card = this;
    }
    
    async setFaceTexture(imagePath) {
        const texture = await loadTexture(imagePath);
        texture.center.set(0.5, 0.5);
        texture.repeat.set(0.98, 0.98);
        this.backMaterial.map = texture;
        this.backMaterial.color.set(0xffffff);
        
        // Extract base filename (e.g., "images/idea-1.png" -> "idea-1")
        const filename = imagePath.split('/').pop().split('.')[0];
        
        try {
            // Attempt to load specific normal and roughness maps for this design
            const normalPath = `images/normal/${filename}-normal.png`;
            const roughnessPath = `images/roughness/${filename}-roughness.png`;
            
            // Rules for Face Mapping:
            // 1. Try specific [filename]-normal.png. Fallback: null (No normal map)
            // 2. Try specific [filename]-roughness.png. Fallback: card-roughness.png
            const [normalMap, roughnessMap] = await Promise.all([
                loadTexture(normalPath, true).catch(() => null),
                loadTexture(roughnessPath, true).catch(() => loadTexture('images/roughness/card-roughness.png', true))
            ]);
            
            this.backMaterial.normalMap = normalMap;
            this.backMaterial.roughnessMap = roughnessMap;
            this.backMaterial.roughness = 1.0; // Full map control 
        } catch (err) {
            // Ultimate fallback if loading fails
            this.backMaterial.normalMap = null;
            this.backMaterial.roughnessMap = await loadTexture('images/roughness/card-roughness.png', true);
            this.backMaterial.roughness = 1.0; // Full map control
        }
        
        this.backMaterial.needsUpdate = true;
    }
    
    // Clear textures when the card is recycled
    clearFaceTexture() {
        this.backMaterial.map = null;
        this.backMaterial.normalMap = null;
        this.backMaterial.roughnessMap = null;
        this.backMaterial.color.set(0x1a1a2e);
        this.backMaterial.roughness = 1.0; // Full map control
        this.backMaterial.needsUpdate = true;
    }

    setOpacity(value) {
        this.currentOpacity = value;
        if (this.frontMaterial) this.frontMaterial.opacity = value;
        if (this.backMaterial) this.backMaterial.opacity = value;
        if (this.edgeMaterial) this.edgeMaterial.opacity = value;
    }
    
    setPosition(x, y, z) {
        this.basePosition = { x, y, z };
        this.targetPosition = { x, y, z };
        this.currentPosition = { x, y, z };
        this.group.position.set(x, y, z);
    }
    
    // Animation system
    animate(property, from, to, duration, easing, onComplete) {
        const animation = {
            property,
            from,
            to,
            duration,
            easing,
            elapsed: 0,
            onComplete,
        };
        this.animations.push(animation);
    }
    
    update(deltaTime) {
        // Process animations (defer callbacks to avoid mutating list mid-iteration)
        const completedCallbacks = [];
        this.animations = this.animations.filter(anim => {
            anim.elapsed += deltaTime;
            const progress = Math.min(anim.elapsed / anim.duration, 1);
            const easedProgress = anim.easing(progress);
            
            if (anim.property === 'rotationY') {
                this.currentRotation.y = anim.from + (anim.to - anim.from) * easedProgress;
            } else if (anim.property === 'rotationX') {
                this.currentRotation.x = anim.from + (anim.to - anim.from) * easedProgress;
            } else if (anim.property === 'positionX') {
                this.currentPosition.x = anim.from + (anim.to - anim.from) * easedProgress;
            } else if (anim.property === 'positionY') {
                this.currentPosition.y = anim.from + (anim.to - anim.from) * easedProgress;
            } else if (anim.property === 'positionZ') {
                this.currentPosition.z = anim.from + (anim.to - anim.from) * easedProgress;
            } else if (anim.property === 'scale') {
                this.currentScale = anim.from + (anim.to - anim.from) * easedProgress;
            } else if (anim.property === 'opacity') {
                this.setOpacity(anim.from + (anim.to - anim.from) * easedProgress);
            }
            
            if (progress >= 1) {
                if (anim.onComplete) completedCallbacks.push(anim.onComplete);
                return false;
            }
            return true;
        });
        
        if (completedCallbacks.length) {
            completedCallbacks.forEach(callback => callback());
        }
        
        // Smooth hover tilt interpolation (when hovered and not during flip animation)
        const hasFlipAnim = this.animations.some(a => a.isFlipAnimation);
        if (this.isHovered && !hasFlipAnim) {
            const smoothing = CONFIG.TILT_SMOOTHING;
            this.tiltOffset.x += (this.hoverTiltTarget.x - this.tiltOffset.x) * smoothing;
            this.tiltOffset.y += (this.hoverTiltTarget.y - this.tiltOffset.y) * smoothing;
        } else if (!this.isHovered) {
            // Smoothly return tilt to zero when not hovered
            const smoothing = CONFIG.TILT_SMOOTHING;
            this.tiltOffset.x += (0 - this.tiltOffset.x) * smoothing;
            this.tiltOffset.y += (0 - this.tiltOffset.y) * smoothing;
        }
        
        // Apply transforms: base rotation + tilt offset
        this.group.rotation.x = this.currentRotation.x + this.tiltOffset.x;
        this.group.rotation.y = this.currentRotation.y + this.tiltOffset.y;
        this.group.position.x = this.currentPosition.x;
        this.group.position.y = this.currentPosition.y;
        this.group.position.z = this.currentPosition.z;
        this.group.scale.setScalar(this.currentScale);
    }
    
    // Hover effect - set hover state and animate scale
    setHover(isHovered) {
        // Don't change hover during flip or slide animations
        const hasFlipAnim = this.animations.some(a => a.isFlipAnimation);
        if (hasFlipAnim || this.isSliding) return;
        
        this.isHovered = isHovered;
        
        // Clear existing scale animations
        this.animations = this.animations.filter(a => 
            (a.property !== 'scale' && a.property !== 'positionZ') || a.isFlipAnimation
        );
        
        if (isHovered) {
            SoundManager.playRandomHover();
            this.animate('scale', this.currentScale, CONFIG.HOVER_SCALE, 0.2, easeOutCubic);
            this.animate('positionZ', this.currentPosition.z, 0.3, 0.2, easeOutCubic);
        } else {
            // Reset tilt target when not hovered (tiltOffset will smoothly return to 0 in update())
            this.hoverTiltTarget = { x: 0, y: 0 };
            this.animate('scale', this.currentScale, 1, 0.2, easeOutCubic);
            this.animate('positionZ', this.currentPosition.z, 0, 0.2, easeOutCubic);
        }
    }
    
    // Update hover tilt based on cursor position on card
    // localX and localY are normalized from -1 to 1
    updateHoverTilt(localX, localY) {
        if (!this.isHovered) return;
        
        // Calculate tilt angles based on cursor position
        // Cursor on right → tilt right edge toward viewer (negative Y rotation)
        // Cursor on top → tilt top edge toward viewer (positive X rotation)
        this.hoverTiltTarget.y = -localX * CONFIG.MAX_TILT;
        this.hoverTiltTarget.x = localY * CONFIG.MAX_TILT;
    }
    
    // Flip animation
    flip(onComplete) {
        this.isFlipped = true;
        // Reset tilt offset at start of flip (will be re-applied after flip completes)
        this.tiltOffset = { x: 0, y: 0 };
        
        // Play turn over sound
        SoundManager.playRandomTurnOver();

        const anim = {
            property: 'rotationY',
            from: this.currentRotation.y,
            to: Math.PI,
            duration: CONFIG.FLIP_DURATION,
            easing: easeInOutCubic,
            elapsed: 0,
            onComplete,
            isFlipAnimation: true,
        };
        this.animations.push(anim);
        
        // Also animate Z position back to 0 so it lands on the floor
        this.animate('positionZ', this.currentPosition.z, 0, CONFIG.FLIP_DURATION, easeInOutCubic);
        // Reset X tilt so it lands flat
        this.animate('rotationX', this.currentRotation.x, 0, CONFIG.FLIP_DURATION, easeInOutCubic);
    }
    
    // Full reset (used when card is off-screen and needs to come back fresh)
    reset() {
        this.isFlipped = false;
        this.isHovered = false;
        this.isSliding = false;
        this.currentRotation = { x: 0, y: 0 };
        this.targetRotation = { x: 0, y: 0 };
        this.hoverTiltTarget = { x: 0, y: 0 };
        this.tiltOffset = { x: 0, y: 0 };
        this.baseRotationY = 0;
        this.currentScale = 1;
        this.targetScale = 1;
        this.setOpacity(0);
        
        // Reset position to base
        this.currentPosition = { ...this.basePosition };
        this.targetPosition = { ...this.basePosition };
        
        // Reset transform
        this.group.rotation.set(0, 0, 0);
        this.group.position.set(this.basePosition.x, this.basePosition.y, this.basePosition.z);
        this.group.scale.set(1, 1, 1);
        this.group.updateMatrixWorld(true); // Force matrix update
        
        // Clear all animations
        this.animations = [];
        // Clear face texture
        this.clearFaceTexture();
    }
    
    // Slide out animation - direction based on card position in grid
    slideOut(onComplete) {
        this.isSliding = true;
        
        // Play slide sound
        SoundManager.playSlide();
        
        const col = this.index % CONFIG.GRID_COLS;
        const row = Math.floor(this.index / CONFIG.GRID_COLS);
        
        const onAnimComplete = () => {
            this.isSliding = false;
            if (onComplete) onComplete();
        };
        
        if (col === 0) {
            // Left column: slide LEFT
            const offscreenX = this.basePosition.x - 15;
            this.animate('positionX', this.currentPosition.x, offscreenX, CONFIG.SLIDE_DURATION, easeInCubic, onAnimComplete);
        } else if (col === CONFIG.GRID_COLS - 1) {
            // Right column: slide RIGHT
            const offscreenX = this.basePosition.x + 15;
            this.animate('positionX', this.currentPosition.x, offscreenX, CONFIG.SLIDE_DURATION, easeInCubic, onAnimComplete);
        } else if (row === 0) {
            // Inner columns, top row: slide UP
            const offscreenY = this.basePosition.y + 15;
            this.animate('positionY', this.currentPosition.y, offscreenY, CONFIG.SLIDE_DURATION, easeInCubic, onAnimComplete);
        } else {
            // Inner columns, bottom row: slide DOWN
            const offscreenY = this.basePosition.y - 15;
            this.animate('positionY', this.currentPosition.y, offscreenY, CONFIG.SLIDE_DURATION, easeInCubic, onAnimComplete);
        }
    }
    
    // Slide in from top
    slideIn(onComplete, zOffset = 0) {
        this.isSliding = true;
        
        // Play place sound
        SoundManager.playRandomPlace();
        
        const finalTargetZ = this.basePosition.z; // Always land at base Z (0)
        const startZ = finalTargetZ + zOffset + CONFIG.Z_DROP_START;
        const overshootZ = finalTargetZ + zOffset - CONFIG.Z_DROP_BOUNCE;
        
        this.currentPosition.x = this.basePosition.x;
        this.currentPosition.y = this.basePosition.y;
        this.currentPosition.z = startZ;
        
        // Force update position immediately
        this.group.position.set(this.currentPosition.x, this.currentPosition.y, this.currentPosition.z);
        this.group.updateMatrixWorld(true);
        
        this.setOpacity(0);
        this.animate('opacity', 0, 1, CONFIG.Z_DROP_DURATION, easeOutCubic);
        this.animate(
            'positionZ',
            startZ,
            overshootZ,
            CONFIG.Z_DROP_DURATION * 0.8,
            easeOutCubic,
            () => {
                this.animate(
                    'positionZ',
                    overshootZ,
                    finalTargetZ,
                    CONFIG.Z_DROP_DURATION * 0.2,
                    easeInOutCubic,
                    () => {
                        this.isSliding = false;
                        if (onComplete) onComplete();
                    }
                );
            }
        );
    }
}

// =============================================================================
// SCENE SETUP
// =============================================================================
function initScene() {
    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.BACKGROUND_COLOR);
    
    // Camera
    const aspect = window.innerWidth / window.innerHeight;
    camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100);
    camera.position.z = 8;
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // Softer shadows
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    const canvasContainer = document.getElementById('canvas-container');
    canvasContainer.appendChild(renderer.domElement);

    const unlockHandler = () => {
        unlockAudioOnce();
        renderer.domElement.removeEventListener('pointerdown', unlockHandler);
        renderer.domElement.removeEventListener('click', unlockHandler);
    };
    renderer.domElement.addEventListener('pointerdown', unlockHandler, { passive: true });
    renderer.domElement.addEventListener('click', unlockHandler, { passive: true });

    if (showIntro) {
        isIntroSequence = true;
        introCard = new Card(-1); // Use -1 for intro card index
        introCard.init().then(() => {
            introCard.setPosition(0, 0, 0);
            introCard.setFaceTexture('images/intro.png');
            introCard.setOpacity(1);
            scene.add(introCard.group);
        });
    }
    
    // Lighting - Studio Product Photography Setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);
    
    const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
    scene.add(hemisphereLight);
    
    // Key Light: Main SpotLight from top-left
    const keyLight = new THREE.SpotLight(0xffffff, 100.0);
    keyLight.position.set(-10, 10, 10);
    keyLight.angle = Math.PI / 4;
    keyLight.penumbra = 0.5; // Softer edges
    keyLight.decay = 1.5;
    keyLight.distance = 30;
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    scene.add(keyLight);
    
    // Fill Light: Soft light from the opposite side
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(10, 5, 5);
    scene.add(fillLight);
    
    // Front/Top Light: Ensures card faces are always bright
    const topLight = new THREE.DirectionalLight(0xffffff, 0.6);
    topLight.position.set(0, 10, 10);
    scene.add(topLight);
    
    // Floor for shadows
    const floorGeometry = new THREE.PlaneGeometry(50, 50);
    const floorMaterial = new THREE.ShadowMaterial({ opacity: 0.15 });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.position.z = -0.01; // Closer to cards for tighter shadow
    floor.receiveShadow = true;
    scene.add(floor);
    
    // Raycaster
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    
    // Event listeners
    window.addEventListener('resize', onWindowResize);
    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('click', onClick);
    renderer.domElement.style.cursor = 'pointer';
}

function applyBackgroundForSet(setNum) {
    const color = CONFIG.BACKGROUND_COLORS_BY_SET[setNum - 1];
    if (!color) return;
    backgroundTransition.isActive = true;
    backgroundTransition.startColor.copy(scene.background);
    backgroundTransition.targetColor.set(color);
    backgroundTransition.startTime = performance.now();
    backgroundTransition.duration = CONFIG.BACKGROUND_TRANSITION_DURATION;
}

// =============================================================================
// GRID LAYOUT
// =============================================================================
async function createCards() {
    const { CARD_WIDTH, CARD_HEIGHT, CARD_GAP, GRID_COLS, GRID_ROWS } = CONFIG;
    
    const totalWidth = GRID_COLS * CARD_WIDTH + (GRID_COLS - 1) * CARD_GAP;
    const totalHeight = GRID_ROWS * CARD_HEIGHT + (GRID_ROWS - 1) * CARD_GAP;
    
    const startX = -totalWidth / 2 + CARD_WIDTH / 2;
    const startY = totalHeight / 2 - CARD_HEIGHT / 2;
    
    // Create all cards
    for (let i = 0; i < 8; i++) {
        const card = new Card(i);
        
        const col = i % GRID_COLS;
        const row = Math.floor(i / GRID_COLS);
        
        const x = startX + col * (CARD_WIDTH + CARD_GAP);
        const y = startY - row * (CARD_HEIGHT + CARD_GAP);
        
        card.setPosition(x, y, 0);
        cards.push(card);
        scene.add(card.group);
    }
    
    // Wait for all cards to initialize their meshes (load textures)
    await Promise.all(cards.map(card => card.init()));
}

// =============================================================================
// SET MANAGEMENT (Infinite Loop)
// =============================================================================
function refillSets() {
    const sets = Array.from({ length: CONFIG.TOTAL_IMAGE_SETS }, (_, i) => i + 1);
    // Shuffle
    for (let i = sets.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sets[i], sets[j]] = [sets[j], sets[i]];
    }
    availableSets = [...availableSets, ...sets];
}

function getNextSet() {
    if (availableSets.length === 0) refillSets();
    
    // If the next set is the same as last, try to find a different one
    if (availableSets[0] === lastShownSet && availableSets.length > 1) {
        // Find first different set and move it to front
        const idx = availableSets.findIndex(s => s !== lastShownSet);
        if (idx > 0) {
            const temp = availableSets[idx];
            availableSets.splice(idx, 1);
            availableSets.unshift(temp);
        }
    }
    
    lastShownSet = availableSets.shift();
    return lastShownSet;
}

// =============================================================================
// INTERACTION HANDLERS
// =============================================================================
function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    
    const intersects = raycaster.intersectObjects(scene.children, true);
    let newHoveredCard = null;
    let intersectionPoint = null;
    
    for (const intersect of intersects) {
        if (intersect.object.userData.card) {
            newHoveredCard = intersect.object.userData.card;
            intersectionPoint = intersect.point;
            break;
        }
    }
    
    // Handle hover state changes
    if (newHoveredCard !== hoveredCard) {
        if (hoveredCard) hoveredCard.setHover(false);
        if (newHoveredCard) {
            // Allow hover on intro card or regular cards depending on state
            if (isIntroSequence) {
                if (newHoveredCard === introCard && !introCard.isFlipped) newHoveredCard.setHover(true);
            } else {
                newHoveredCard.setHover(true);
            }
        }
        hoveredCard = newHoveredCard;
    }
    
    // Update tilt based on cursor position on card
    if (hoveredCard && intersectionPoint) {
        // Convert world intersection point to local card coordinates
        const cardPos = hoveredCard.group.position;
        const localX = intersectionPoint.x - cardPos.x;
        const localY = intersectionPoint.y - cardPos.y;
        
        // Normalize to -1 to 1 based on card dimensions
        const normalizedX = (localX / (CONFIG.CARD_WIDTH / 2));
        const normalizedY = (localY / (CONFIG.CARD_HEIGHT / 2));
        
        // Clamp to -1 to 1
        const clampedX = Math.max(-1, Math.min(1, normalizedX));
        const clampedY = Math.max(-1, Math.min(1, normalizedY));
        
        hoveredCard.updateHoverTilt(clampedX, clampedY);
    }
}

function onClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    
    const intersects = raycaster.intersectObjects(scene.children, true);
    
    for (const intersect of intersects) {
        if (intersect.object.userData.card) {
            const card = intersect.object.userData.card;
            
            if (isIntroSequence && card === introCard) {
                handleIntroCardClick();
                break;
            }
            
            if (!isIntroSequence) {
                handleCardClick(card.index);
                break;
            }
        }
    }
}

function handleIntroCardClick() {
    if (!introCard || introCard.isFlipped || introCard.isSliding) return;
    
    // Clear hover state before flipping to prevent tilt
    introCard.isHovered = false;
    introCard.hoverTiltTarget = { x: 0, y: 0 };
    
    SoundManager.playIntroClick();
    
    introCard.flip(() => {
        setTimeout(() => {
            // Play slide sound for intro card
            SoundManager.playSlide();
            
            introCard.slideOut(() => {
                scene.remove(introCard.group);
                introCard = null;
                isIntroSequence = false;
                startIntroPlacement();
            });
        }, CONFIG.REVEAL_STAY_TIME * 1000);
    });
}

// =============================================================================
// GAME LOGIC
// =============================================================================
function handleCardClick(index) {
    if (showIntro) return;
    // 1. Check if clicked card is available
    if (slotStates[index] !== 'available') return;
    
    // 2. Find other available slots for the EXECUTION card
    const otherAvailableIndices = slotStates
        .map((state, i) => (state === 'available' && i !== index ? i : null))
        .filter(i => i !== null);
    
    // If no other card is available, can't form a pair
    if (otherAvailableIndices.length === 0) return;
    
    // 3. Randomly pick the EXECUTION card
    const executionIndex = otherAvailableIndices[Math.floor(Math.random() * otherAvailableIndices.length)];
    
    // 4. Mark both as busy immediately
    slotStates[index] = 'busy';
    slotStates[executionIndex] = 'busy';
    
    const ideaCard = cards[index];
    const execCard = cards[executionIndex];
    
    ideaCard.state = 'busy';
    execCard.state = 'busy';
    
    // Clear hover state
    ideaCard.setHover(false);
    execCard.setHover(false);
    
    // 5. Assign images for this specific reveal
    const setNum = getNextSet();
    ideaCard.setFaceTexture(`images/idea-${setNum}.png`);
    execCard.setFaceTexture(`images/execution-${setNum}.png`);
    
    // 6. Flip IDEA card immediately
    ideaCard.flip();
    
    // 7. Flip EXECUTION card after stagger delay
    setTimeout(() => {
        applyBackgroundForSet(setNum);
        execCard.flip();
    }, CONFIG.STAGGER_DELAY * 1000);
    
    // 8. After both flipped and stay time, slide out and replace
    const totalWaitTime = (CONFIG.STAGGER_DELAY + CONFIG.FLIP_DURATION + CONFIG.REVEAL_STAY_TIME) * 1000;
    
    setTimeout(() => {
        animateOutAndIn(index, executionIndex);
    }, totalWaitTime);
}

function animateOutAndIn(idxA, idxB) {
    const cardA = cards[idxA];
    const cardB = cards[idxB];
    
    // Slide both down
    let slidesDownComplete = 0;
    const onSlideDownComplete = () => {
        slidesDownComplete++;
        if (slidesDownComplete === 2) {
            // Fully reset cards while hidden (clears isHovered, animations, textures, etc.)
            cardA.reset();
            cardB.reset();
            
            // Keep cardB hidden and at start position during the stagger delay
            cardB.setOpacity(0);
            cardB.currentPosition.z = cardB.basePosition.z + CONFIG.Z_DROP_START;
            cardB.group.position.z = cardB.currentPosition.z;
            
            // Keep state as busy during slide-in
            cardA.state = 'busy';
            cardB.state = 'busy';
            
            // Slide both back in
            let slidesInComplete = 0;
            const onSlideInComplete = () => {
                slidesInComplete++;
                if (slidesInComplete === 2) {
                    // Now mark as available - cards are ready for interaction
                    slotStates[idxA] = 'available';
                    slotStates[idxB] = 'available';
                    cardA.state = 'available';
                    cardB.state = 'available';
                }
            };
            
            const pairOffset = 0.05;
            cardA.slideIn(onSlideInComplete, pairOffset);
            setTimeout(() => {
                cardB.slideIn(onSlideInComplete, -pairOffset);
            }, CONFIG.REPLACEMENT_STAGGER * 1000);
        }
    };
    
    cardA.slideOut(onSlideDownComplete);
    setTimeout(() => {
        cardB.slideOut(onSlideDownComplete);
    }, CONFIG.REPLACEMENT_STAGGER * 1000);
}

// =============================================================================
// ANIMATION LOOP
// =============================================================================
let lastTime = 0;

function animate(currentTime) {
    requestAnimationFrame(animate);
    
    const deltaTime = (currentTime - lastTime) / 1000;
    lastTime = currentTime;
    
    // Update all cards
    for (const card of cards) {
        card.update(deltaTime);
    }
    
    // Update intro card if it exists
    if (introCard) {
        introCard.update(deltaTime);
    }

    if (backgroundTransition.isActive) {
        const elapsed = (currentTime - backgroundTransition.startTime) / 1000;
        const progress = Math.min(elapsed / backgroundTransition.duration, 1);
        const easedProgress = easeInOutCubic(progress);
        const blended = backgroundTransition.startColor.clone().lerp(
            backgroundTransition.targetColor,
            easedProgress
        );
        scene.background = blended;
        
        // Update card edges to reflect the background
        const edgeColor = blended.clone().addScalar(0.12); // Slightly lighter
        for (const card of cards) {
            if (card.edgeMaterial) {
                card.edgeMaterial.color.copy(edgeColor);
            }
        }
        
        if (progress >= 1) {
            backgroundTransition.isActive = false;
        }
    }
    
    renderer.render(scene, camera);
}

// =============================================================================
// INITIALIZATION
// =============================================================================
async function init() {
    SoundManager.init();
    initScene();
    await createCards();  // Wait for all cards and textures to be ready
    if (showIntro) {
        hideCardsForIntro();
    }
    refillSets();
    
    // Start animation loop
    requestAnimationFrame(animate);
}

// Start
init();
