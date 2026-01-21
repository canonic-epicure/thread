import * as THREE from 'three'
import { createSphereController } from './sphere'
import { createPlaneController } from './plane'
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

const baseMaterialParams = {
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0.1
}

const { sphereMaterial, updateSphere } = createSphereController({
    renderer,
    camera,
    scene,
    materialParams: baseMaterialParams,
    letterColor,
    gridColor
})

const { planeMaterial, updatePlane } = createPlaneController({
    renderer,
    scene,
    materialParams: baseMaterialParams,
    letterColor,
    gridColor,
    letterFillAlpha
})

planeMaterial.color.copy(sphereMaterial.color)
planeMaterial.roughness = sphereMaterial.roughness
planeMaterial.metalness = sphereMaterial.metalness
planeMaterial.color.set(0x000000)


function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', onResize)

const clock = new THREE.Clock()

function animate() {
    requestAnimationFrame(animate)
    const delta = clock.getDelta()
    updateSphere(delta)
    updatePlane(delta)
    renderer.render(scene, camera)
}
animate()
