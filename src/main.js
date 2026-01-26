import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import GUI from 'lil-gui';
import { createSphereController } from './sphere.js';
import { createSpiralController } from './spiral.js';
import { initSoundCloud } from './sound';
import { createNoiseShader } from './noise';
import { DEFAULT_LONG_TEXT } from './text';
import { LlmTextStream, TextStreamBuffer } from './text-stream';
import './style.css';
const app = document.querySelector('#app');
if (!app) {
    throw new Error('Missing #app element');
}
initSoundCloud(app, {
    trackUrl: 'https://soundcloud.com/shawn-scarber/drawing-by-tomasz-bednarczyk-stretched',
    startMs: 45000
});
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(90, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 3.2);
const ambient = new THREE.AmbientLight(0xffffff, 0.9);
const directional = new THREE.DirectionalLight(0xffffff, 0.8);
directional.position.set(2, 3, 4);
scene.add(ambient, directional);
const sphereLetterAlpha = 1.0;
const sphereGridAlpha = 1;
const colorState = {
    background: '#565656',
    sphereColor: '#7d7d7d',
    sphereLetters: '#cccccc',
    spiralPlane: '#687a82',
    spiralLetters: '#cccccc'
};
const typographyState = {
    fontFamily: 'Roboto'
};
const toRgba = (hex, alpha) => {
    const color = new THREE.Color(hex);
    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);
    return `rgba(${r},${g},${b},${alpha})`;
};
scene.background = new THREE.Color(colorState.background);
const letterColor = toRgba(colorState.sphereLetters, sphereLetterAlpha);
const gridColor = toRgba(colorState.sphereLetters, sphereGridAlpha);
const sharedSurface = {
    roughness: 0.6,
    metalness: 0.1,
    sphereColor: Number.parseInt(colorState.sphereColor.replace('#', ''), 16),
    planeColor: 0x000000
};
const baseMaterialParams = {
    color: sharedSurface.sphereColor,
    roughness: sharedSurface.roughness,
    metalness: sharedSurface.metalness
};
const textBuffer = new TextStreamBuffer(DEFAULT_LONG_TEXT, 80000);
const { sphere, updateSphere, getSphereState, setSphereColor, setSphereLetterColor, setSphereFont, setSphereText } = createSphereController({
    renderer,
    camera,
    materialParams: baseMaterialParams,
    letterColor,
    gridColor,
    fontFamily: typographyState.fontFamily,
    text: textBuffer.getText()
});
scene.add(sphere);
setSphereColor(colorState.sphereColor);
const { spiralPlane, updateSpiral, setSpiralPlaneColor, setSpiralLetterColor, setSpiralFont, setSpiralText } = createSpiralController({
    renderer,
    materialParams: baseMaterialParams,
    planeColor: Number.parseInt(colorState.spiralPlane.replace('#', ''), 16),
    letterColor: Number.parseInt(colorState.spiralLetters.replace('#', ''), 16),
    fontFamily: typographyState.fontFamily,
    text: textBuffer.getText()
});
scene.add(spiralPlane);
const textStream = new LlmTextStream(textBuffer, {
    maxLength: 80000,
    refillThreshold: 40000,
    minUpdateIntervalMs: 1000
}, {
    onUpdate: (nextText) => {
        setSphereText(nextText);
        setSpiralText(nextText);
    },
    onError: (error) => {
        console.warn('Text stream error', error);
    }
});
textStream.start();
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const noisePass = new ShaderPass(createNoiseShader(0.061125, 2.8, 0.12));
composer.addPass(noisePass);
const gui = new GUI({ title: 'Inspector' });
const colorFolder = gui.addFolder('Colors');
colorFolder
    .addColor(colorState, 'background')
    .name('Background')
    .onChange((value) => {
    scene.background = new THREE.Color(value);
});
colorFolder
    .addColor(colorState, 'sphereColor')
    .name('Sphere')
    .onChange((value) => setSphereColor(value));
colorFolder
    .addColor(colorState, 'sphereLetters')
    .name('Sphere Letters')
    .onChange((value) => setSphereLetterColor(toRgba(value, sphereLetterAlpha), toRgba(value, sphereGridAlpha)));
colorFolder
    .addColor(colorState, 'spiralPlane')
    .name('Spiral Plane')
    .onChange((value) => setSpiralPlaneColor(value));
colorFolder
    .addColor(colorState, 'spiralLetters')
    .name('Spiral Letters')
    .onChange((value) => setSpiralLetterColor(value));
colorFolder.open();
const typographyFolder = gui.addFolder('Typography');
typographyFolder
    .add(typographyState, 'fontFamily', ['monospace', 'Roboto'])
    .name('Font')
    .onChange((value) => {
    if (document.fonts) {
        document.fonts.load(`700 40px ${value}`).finally(() => {
            setSphereFont(value);
            setSpiralFont(value);
        });
        return;
    }
    setSphereFont(value);
    setSpiralFont(value);
});
const noiseFolder = gui.addFolder('Noise');
noiseFolder
    .add(noisePass.uniforms.uAmount, 'value', 0, 0.4, 0.0025)
    .name('Amount');
noiseFolder
    .add(noisePass.uniforms.uScale, 'value', 0.5, 6, 0.05)
    .name('Scale');
noiseFolder
    .add(noisePass.uniforms.uSpeed, 'value', 0, 0.5, 0.005)
    .name('Speed');
noiseFolder.open();
function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
window.addEventListener('resize', onResize);
window.addEventListener('mousemove', (event) => {
    mouseX = (event.clientX / window.innerWidth) * 2 - 1;
    mouseY = (event.clientY / window.innerHeight) * 2 - 1;
});
const clock = new THREE.Clock();
let cameraShakeY = 0;
let mouseX = 0;
let mouseY = 0;
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    updateSphere(delta);
    updateSpiral(delta, getSphereState());
    camera.position.y += Math.cos(cameraShakeY) / 500;
    cameraShakeY += 0.02;
    // mouse camera move
    camera.position.x += (mouseX * 0.5 - camera.position.x) * 0.02;
    camera.position.y += (-mouseY * 0.3 - camera.position.y) * 0.02;
    camera.position.y = Math.max(camera.position.y, -1);
    noisePass.uniforms.uTime.value += delta;
    composer.render();
}
animate();
