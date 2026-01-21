import * as THREE from 'three'
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

const { sphere, updateSphere } = createSphereController({
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
    planeColor: sharedSurface.planeColor
})
scene.add(spiralPlane)


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
    // updatePlane(delta)
    updateSpiral(delta)
    renderer.render(scene, camera)
}
animate()
