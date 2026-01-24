import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Configuration
const TICKET_RATIO = 36 / 14;
const TICKET_WIDTH = 4;
const TICKET_HEIGHT = TICKET_WIDTH / TICKET_RATIO;
const TICKET_DEPTH = 0.02; // Thinner ticket
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = Math.floor(CANVAS_WIDTH / TICKET_RATIO);

// Artwork Configuration - Initial state, to be populated from JSON
let ARTWORKS = {};
let currentArtwork = {
    displayName: 'LOADING...',
    posterPath: '',
    color: '#CCFF00',
    createdDate: '260120'
};

// Get current artwork from URL query param
const urlParams = new URLSearchParams(window.location.search);
const artworkId = urlParams.get('artwork') || 'just-vibe';

// Fetch Configuration
fetch('./data/artworks.json')
    .then(response => response.json())
    .then(data => {
        ARTWORKS = data;
        // Merge with default if missing
        const config = ARTWORKS[artworkId] || ARTWORKS['just-vibe'];
        currentArtwork = {
            ...config,
            color: '#CCFF00' // Force unified Neon Green as requested
        };
        
        // Initialize after config is loaded
        initializeApp();
    })
    .catch(error => {
        console.error('Error loading artwork config:', error);
        // Fallback initialization
        initializeApp();
    });

function initializeApp() {
    // Update page title
    document.title = `Ticket - ${currentArtwork.displayName}`;

    // Update UI colors based on artwork
    const dynamicStyle = document.createElement('style');
    dynamicStyle.innerHTML = `
        label, .download-btn { color: ${currentArtwork.color} !important; }
        input { border-bottom-color: ${currentArtwork.color} !important; }
        .download-btn:hover { filter: drop-shadow(0 0 5px ${currentArtwork.color}80) !important; }
    `;
    document.head.appendChild(dynamicStyle);

    // Update poster source
    posterImage.src = currentArtwork.posterPath;
    
    // If ticket mesh already exists (race condition), update texture
    if (ticketMesh) {
        updateTicketTexture();
    } else {
        // Or if scene setup was waiting
        // Actually scene setup runs immediately, initTicket runs on poster load.
        // If poster load happens before config load, we might have issues.
        // We set posterImage.src here, so posterImage.onload will trigger initTicket.
    }
}


// Scene Setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 5, 5);
scene.add(directionalLight);

// Texture Canvas (Front)
const canvas = document.createElement('canvas');
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;
const ctx = canvas.getContext('2d');

// Texture Canvas (Back)
const backCanvas = document.createElement('canvas');
backCanvas.width = CANVAS_WIDTH;
backCanvas.height = CANVAS_HEIGHT;
const backCtx = backCanvas.getContext('2d');

// Load Assets
const imageLoader = new THREE.ImageLoader();
const posterImage = new Image();
posterImage.crossOrigin = "anonymous";
    // Use dynamic poster path
    // posterImage.src = currentArtwork.posterPath; // Moved to initializeApp

const qrImage = new Image();
qrImage.crossOrigin = "anonymous";
// Adjusted path for root ticket folder
qrImage.src = '../public/images/mediaArtQRcode.png'; 
let isQRLoaded = false;

qrImage.onload = () => {
    isQRLoaded = true;
    updateTicketTexture();
};

let texture;
let backTexture;
let material;
let ticketMesh;

// State
let username = "";
const enterTime = new Date();
const formattedTime = formatDate(enterTime);

// DOM Elements
const usernameInput = document.getElementById('username-input');
const timestampDisplay = document.getElementById('timestamp');
const downloadBtn = document.getElementById('download-btn');

timestampDisplay.textContent = formattedTime;

usernameInput.addEventListener('input', (e) => {
    username = e.target.value;
    updateTicketTexture();
});

downloadBtn.addEventListener('click', downloadTicketImage);

posterImage.onload = () => {
    initTicket();
};

// Handle image load error (fallback)
posterImage.onerror = () => {
    console.warn(`Failed to load poster: ${currentArtwork.posterPath}`);
    // Maybe load a default or placeholder?
    // For now we continue, it will just be blank/black where image should be
    initTicket();
};

function initTicket() {
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    backTexture = new THREE.CanvasTexture(backCanvas);
    backTexture.colorSpace = THREE.SRGBColorSpace;
    backTexture.minFilter = THREE.LinearFilter;
    backTexture.magFilter = THREE.LinearFilter;

    // Front material with dynamic texture
    const frontMaterial = new THREE.MeshStandardMaterial({ 
        map: texture,
        roughness: 0.2,
        metalness: 0.6
    });

    // Back material with dynamic texture
    const backMaterial = new THREE.MeshStandardMaterial({ 
        map: backTexture,
        roughness: 0.2,
        metalness: 0.6
    });

    // Side material (solid color based on artwork)
    const bodyMaterial = new THREE.MeshStandardMaterial({ 
        color: new THREE.Color(currentArtwork.color),
        roughness: 0.2,
        metalness: 0.6
    });

    const materials = [
        bodyMaterial, // right
        bodyMaterial, // left
        bodyMaterial, // top
        bodyMaterial, // bottom
        frontMaterial, // front
        backMaterial  // back
    ];

    const geometry = new THREE.BoxGeometry(TICKET_WIDTH, TICKET_HEIGHT, TICKET_DEPTH);
    ticketMesh = new THREE.Mesh(geometry, materials);
    ticketMesh.position.y = 0.4; // Slightly raise the ticket
    ticketMesh.rotation.y = -Math.PI / 6; // Rotate 30 degrees
    scene.add(ticketMesh);

    updateTicketTexture();
    animate();
}

function updateTicketTexture() {
    if (!ctx) return;
    drawTicket(ctx, false);
    if (texture) texture.needsUpdate = true;
    updateBackTicketTexture();
}

function drawTicket(context, useRealQR = false) {
    // Background
    context.fillStyle = currentArtwork.color;
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Image (Left side)
    const circleX = CANVAS_HEIGHT / 2 + 50; // Padding from left
    const circleY = CANVAS_HEIGHT / 2;
    const circleRadius = CANVAS_HEIGHT * 0.45;

    context.save();
    context.beginPath();
    context.arc(circleX, circleY, circleRadius, 0, Math.PI * 2);
    context.closePath();
    context.clip();
    
    // Draw image centered in the circle
    if (posterImage.complete && posterImage.naturalWidth > 0) {
        const imgAspect = posterImage.width / posterImage.height;
        let drawWidth = circleRadius * 2;
        let drawHeight = drawWidth / imgAspect;
        if (drawHeight < circleRadius * 2) {
            drawHeight = circleRadius * 2;
            drawWidth = drawHeight * imgAspect;
        }
        context.drawImage(posterImage, circleX - drawWidth/2, circleY - drawHeight/2, drawWidth, drawHeight);
    } else {
        // Placeholder if image missing
        context.fillStyle = '#000000';
        context.fillRect(circleX - circleRadius, circleY - circleRadius, circleRadius * 2, circleRadius * 2);
    }
    context.restore();

    // Text styling
    context.fillStyle = '#000000';
    context.font = 'bold 24px "Share Tech Mono", monospace';
    context.textBaseline = 'top';

    // Top Right: Display Name
    context.textAlign = 'right';
    context.fillText(currentArtwork.displayName, CANVAS_WIDTH - 50, 40);

    // Right Middle: username
    const rightCenterX = CANVAS_WIDTH * 0.75;
    const centerY = CANVAS_HEIGHT / 2 - 20;

    context.textAlign = 'center';
    
    // User input
    context.font = '40px "Share Tech Mono", monospace';
    // Center the block vertically
    context.fillText(username || 'YOUR NAME', rightCenterX, centerY - 15);

    // Timestamp under name
    context.font = '20px "Share Tech Mono", monospace';
    context.fillText(formattedTime.replace('\n', ' '), rightCenterX, centerY + 35);
    
    // QR Code
    const qrSize = 60;
    const qrX = CANVAS_WIDTH - qrSize - 30;
    const qrY = CANVAS_HEIGHT - qrSize - 30;

    if (useRealQR && isQRLoaded) {
        context.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
    } else {
        context.fillStyle = '#000000';
        context.fillRect(qrX, qrY, qrSize, qrSize);
        // Fake QR pattern
        context.fillStyle = currentArtwork.color; // Use artwork color
        for(let i=0; i<4; i++) {
            for(let j=0; j<4; j++) {
                if(Math.random() > 0.5) {
                    context.fillRect(qrX + i*13 + 3, qrY + j*13 + 3, 10, 10);
                }
            }
        }
    }

    // Bottom Left Details
    const distFromCenter = qrX - rightCenterX;
    const textWidth = context.measureText(currentArtwork.createdDate || '260120').width;
    const textRightEdge = rightCenterX - distFromCenter - textWidth;

    context.fillStyle = '#000000';
    context.textAlign = 'left'; 
    context.font = '16px "Share Tech Mono", monospace';
    
    // Vertical Alignment
    const bottomY = qrY + qrSize/2 + 12;
    
    context.fillText(currentArtwork.createdDate || '260120', textRightEdge, bottomY - 40);
    context.fillText('HAEUN', textRightEdge, bottomY - 20);
    context.fillText('WEB', textRightEdge, bottomY);
}

function downloadTicketImage() {
    // Draw with Real QR for download
    drawTicket(ctx, true);
    
    const dataURL = canvas.toDataURL('image/png');
    
    // Restore Fake QR for screen
    drawTicket(ctx, false);
    if (texture) texture.needsUpdate = true;

    const link = document.createElement('a');
    link.download = `${artworkId}-ticket-${new Date().getTime()}.png`; // Use artwork ID in filename
    link.href = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function updateBackTicketTexture() {
    if (!backCtx) return;

    // Background
    backCtx.fillStyle = currentArtwork.color;
    backCtx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Flip horizontally to correct for back face mirroring
    backCtx.save();
    // backCtx.translate(CANVAS_WIDTH, 0);
    // backCtx.scale(-1, 1);
    
    // Display Name Large Text
    backCtx.fillStyle = '#000000';
    backCtx.font = 'bold 60px "Share Tech Mono", monospace'; // Large font size
    backCtx.textBaseline = 'middle';
    backCtx.textAlign = 'left';
    
    // Position it roughly centered left-ish like the reference image
    const startX = 100;
    const startY = CANVAS_HEIGHT / 2 - 50;
    
    backCtx.fillText(currentArtwork.displayName, startX, startY);

    // "username" and timestamp below
    backCtx.font = '30px "Share Tech Mono", monospace';
    backCtx.textAlign = 'left';
    
    // "username" text
    const nameY = startY + 100;
    backCtx.fillText(username || 'YOUR NAME', startX, nameY);

    // "timestamp here" text
    const timeX = startX + 300; // Adjust spacing as needed
    backCtx.fillText(formattedTime.replace('\n', ' '), timeX, nameY);

    backCtx.restore();

    if (backTexture) backTexture.needsUpdate = true;
}

function formatDate(date) {
    // 2026-01-24 15:45:00 format
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}\n${hh}:${min}:${ss}`;
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
}

// Handle resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
