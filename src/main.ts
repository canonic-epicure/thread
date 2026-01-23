import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { createSphereController } from './sphere'
// import { createPlaneController } from './plane'
import { createSpiralController } from './spiral'
import './style.css'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) {
    throw new Error('Missing #app element')
}

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x0b0b0b)

const noiseShader = {
    uniforms: {
        tDiffuse: { value: null },
        uTime: { value: 0 },
        uAmount: { value: 0.1125 }
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
            vec2 uv = vUv * 2.8 + uTime * 0.12;
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
const letterColor = `rgba(255,255,255,${letterFillAlpha})`
const gridColor = `rgba(255,255,255,${letterFillAlpha})`

const sharedSurface = {
    roughness: 0.6,
    metalness: 0.1,
    sphereColor: 0xffffff,
    planeColor: 0x000000
}

const baseMaterialParams = {
    color: sharedSurface.sphereColor,
    roughness: sharedSurface.roughness,
    metalness: sharedSurface.metalness
}

const { sphere, updateSphere, getSphereState } = createSphereController({
    renderer,
    camera,
    materialParams: baseMaterialParams,
    letterColor,
    gridColor
})
scene.add(sphere)

// const { plane, updatePlane } = createPlaneController({
//     renderer,
//     materialParams: baseMaterialParams,
//     gridColor,
//     letterFillAlpha,
//     planeColor: sharedSurface.planeColor
// })
// scene.add(plane)

const { spiralPlane, updateSpiral } = createSpiralController({
    renderer,
    materialParams: baseMaterialParams,
    planeColor: 0x0b0b0b,
    letterColor: 0xffffff
})
scene.add(spiralPlane)

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const noisePass = new ShaderPass(noiseShader)
composer.addPass(noisePass)

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
    // updatePlane(delta)
    updateSpiral(delta, getSphereState())

    camera.position.y += Math.cos(cameraShakeY) / 500
    cameraShakeY += 0.02

    // mouse camera move
    camera.position.x += (mouseX * 0.5 - camera.position.x) * 0.02

    noisePass.uniforms.uTime.value += delta
    composer.render()
}
animate()
