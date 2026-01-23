import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import GUI from 'lil-gui'
import { createSphereController } from './sphere.js'
import { createSpiralController } from './spiral.js'
import { initSoundCloud } from './sound'
import './style.css'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
    throw new Error('Missing #app element')
}

initSoundCloud(app, {
    trackUrl:
        'https://soundcloud.com/shawn-scarber/drawing-by-tomasz-bednarczyk-stretched',
    startMs: 45000
})

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1e1e1e)

const noiseShader = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uAmount: { value: 0.061125 },
        uScale: { value: 2.8 },
        uSpeed: { value: 0.12 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime;
        uniform float uAmount;
        uniform float uScale;
        uniform float uSpeed;
        varying vec2 vUv;

        float hash(vec2 p) {
            p = fract(p * vec2(123.34, 456.21));
            p += dot(p, p + 34.345);
            return fract(p.x * p.y);
        }

        float noise2d(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            float a = hash(i);
            float b = hash(i + vec2(1.0, 0.0));
            float c = hash(i + vec2(0.0, 1.0));
            float d = hash(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(a, b, u.x) +
                (c - a) * u.y * (1.0 - u.x) +
                (d - b) * u.x * u.y;
        }

        float pinkNoise(vec2 p) {
            float value = 0.0;
            float amplitude = 1.0;
            float frequency = 1.0;
            for (int i = 0; i < 5; i += 1) {
                value += noise2d(p * frequency) * amplitude;
                frequency *= 2.0;
                amplitude *= 0.5;
            }
            return value;
        }

        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            vec2 uv = vUv * uScale + uTime * uSpeed;
            float pink = pinkNoise(uv);
            float noise = pink - 0.5;
            color.rgb += noise * uAmount;
            gl_FragColor = color;
        }
    `
}

const camera = new THREE.PerspectiveCamera(
    90,
    window.innerWidth / window.innerHeight,
    0.1,
    100
)
camera.position.set(0, 0, 3.2)

const ambient = new THREE.AmbientLight(0xffffff, 0.9)
const directional = new THREE.DirectionalLight(0xffffff, 0.8)
directional.position.set(2, 3, 4)
scene.add(ambient, directional)

const letterFillAlpha = 0.75
const colorState = {
    sphereColor: '#b66363',
    sphereLetters: '#ffffff',
    spiralPlane: '#5d7a89',
    spiralLetters: '#ffffff'
}
const toRgba = (hex: string, alpha: number) => {
    const color = new THREE.Color(hex)
    const r = Math.round(color.r * 255)
    const g = Math.round(color.g * 255)
    const b = Math.round(color.b * 255)
    return `rgba(${r},${g},${b},${alpha})`
}
const letterColor = toRgba(colorState.sphereLetters, letterFillAlpha)
const gridColor = toRgba(colorState.sphereLetters, letterFillAlpha)

const sharedSurface = {
    roughness: 0.6,
    metalness: 0.1,
    sphereColor: Number.parseInt(colorState.sphereColor.replace('#', ''), 16),
    planeColor: 0x000000
}

const baseMaterialParams = {
    color: sharedSurface.sphereColor,
    roughness: sharedSurface.roughness,
    metalness: sharedSurface.metalness
}

const { sphere, updateSphere, getSphereState, setSphereColor, setSphereLetterColor } =
    createSphereController({
    renderer,
    camera,
    materialParams: baseMaterialParams,
    letterColor,
    gridColor
    })
scene.add(sphere)
setSphereColor(colorState.sphereColor)

const {
    spiralPlane,
    updateSpiral,
    setSpiralPlaneColor,
    setSpiralLetterColor
} = createSpiralController({
    renderer,
    materialParams: baseMaterialParams,
    planeColor: Number.parseInt(colorState.spiralPlane.replace('#', ''), 16),
    letterColor: Number.parseInt(colorState.spiralLetters.replace('#', ''), 16)
})
scene.add(spiralPlane)

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const noisePass = new ShaderPass(noiseShader)
composer.addPass(noisePass)

const gui = new GUI({ title: 'Inspector' })
const colorFolder = gui.addFolder('Colors')
colorFolder
    .addColor(colorState, 'sphereColor')
    .name('Sphere')
    .onChange((value: string) => setSphereColor(value))
colorFolder
    .addColor(colorState, 'sphereLetters')
    .name('Sphere Letters')
    .onChange((value: string) =>
        setSphereLetterColor(toRgba(value, letterFillAlpha), toRgba(value, letterFillAlpha))
    )
colorFolder
    .addColor(colorState, 'spiralPlane')
    .name('Spiral Plane')
    .onChange((value: string) => setSpiralPlaneColor(value))
colorFolder
    .addColor(colorState, 'spiralLetters')
    .name('Spiral Letters')
    .onChange((value: string) => setSpiralLetterColor(value))
colorFolder.open()
const noiseFolder = gui.addFolder('Noise')
noiseFolder
    .add(noisePass.uniforms.uAmount, 'value', 0, 0.4, 0.0025)
    .name('Amount')
noiseFolder
    .add(noisePass.uniforms.uScale, 'value', 0.5, 6, 0.05)
    .name('Scale')
noiseFolder
    .add(noisePass.uniforms.uSpeed, 'value', 0, 0.5, 0.005)
    .name('Speed')
noiseFolder.open()

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
    composer.setSize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', onResize)

window.addEventListener('resize', onResize);
window.addEventListener('mousemove', (event) => {
    mouseX = (event.clientX / window.innerWidth) * 2 - 1
})


const clock = new THREE.Clock()

let cameraShakeY = 0
let mouseX = 0

function animate() {
    requestAnimationFrame(animate)
    const delta = clock.getDelta()

    updateSphere(delta)
    updateSpiral(delta, getSphereState())

    camera.position.y += Math.cos(cameraShakeY) / 500
    cameraShakeY += 0.02

    // mouse camera move
    camera.position.x += (mouseX * 0.5 - camera.position.x) * 0.02

    noisePass.uniforms.uTime.value += delta
    composer.render()
}
animate()
