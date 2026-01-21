import * as THREE from 'three'
import { LONG_TEXT } from './longText'
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

const letterFillAlpha = 0.95
const letterColor = `rgba(255,255,255,${letterFillAlpha})`
const gridColor = `rgba(255,255,255,${letterFillAlpha})`

const baseMaterialParams = {
    color: 0xffffff,
    roughness: 0.6,
    metalness: 0.1
}

const planeSize = 25
const depressionRadius = 3.1
const depressionDepth = 15.4
const depressionFalloff = 18

function getPlaneHeightAt(x: number, y: number): number {
    const r = Math.hypot(x, y)
    if (r > depressionRadius) {
        return 0
    }
    const rNorm = r / depressionRadius
    return -depressionDepth * Math.exp(-depressionFalloff * rNorm * rNorm)
}

function createDepressedPlane(): THREE.Mesh {
    const size = planeSize
    const segments = 200

    const geometry = new THREE.PlaneGeometry(size, size, segments, segments)
    const position = geometry.attributes.position

    for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i)
        const y = position.getY(i)
        position.setZ(i, getPlaneHeightAt(x, y))
    }

    geometry.computeVertexNormals()

    const material = new THREE.MeshStandardMaterial({
        ...baseMaterialParams,
        transparent: true,
        side: THREE.DoubleSide
    })

    const plane = new THREE.Mesh(geometry, material)
    plane.position.set(0, 0, 0)
    plane.rotation.x = -1.3
    plane.rotation.y = 0
    return plane
}

const plane = createDepressedPlane()
scene.add(plane)


type LetterCell = {
    ringIndex: number
    angleIndex: number
    glyph: string
}

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const radialCount = 48
const angularCount = 48
const half = planeSize / 2
const ringStep = half / radialCount
const angleStep = (Math.PI * 2) / angularCount
const sinkRadius = 0.8
const fadeStart = 1.6
const fadeEnd = 0.3
const clock = new THREE.Clock()
const letterCells: LetterCell[] = []
let flowOffset = 0
const gridFlowSpeed = 0.1

function wrapRadius(radius: number, offset: number): number {
    let shifted = radius - offset
    shifted = ((shifted % half) + half) % half
    if (shifted < 0.01) {
        shifted += half
    }
    return shifted
}

const letterCanvas = document.createElement('canvas')
const letterCanvasSize = 4096
letterCanvas.width = letterCanvasSize
letterCanvas.height = letterCanvasSize
const letterCtx = letterCanvas.getContext('2d')
if (!letterCtx) {
    throw new Error('Failed to get 2D context')
}

const letterTexture = new THREE.CanvasTexture(letterCanvas)
letterTexture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
letterTexture.minFilter = THREE.LinearMipmapLinearFilter
letterTexture.magFilter = THREE.LinearFilter
letterTexture.generateMipmaps = true
letterTexture.needsUpdate = true

const letterOverlay = new THREE.Mesh(
    plane.geometry.clone(),
    new THREE.MeshStandardMaterial({
        map: letterTexture,
        transparent: true,
        opacity: 1,
        alphaTest: 0.2,
        depthWrite: false,
        ...baseMaterialParams
    })
)
letterOverlay.renderOrder = 1
plane.add(letterOverlay)

function createLetterCells() {
    let index = 0
    for (let ring = 0; ring < radialCount; ring += 1) {
        for (let angle = 0; angle < angularCount; angle += 1) {
            const cell: LetterCell = {
                ringIndex: ring,
                angleIndex: angle,
                glyph: letters[index % letters.length]
            }
            letterCells.push(cell)
            index += 1
        }
    }
}

createLetterCells()


function createGridTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
    const size = 2048
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        throw new Error('Failed to get 2D context')
    }

    ctx.clearRect(0, 0, size, size)
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, size, size)

    const columnCount = SPHERE_COLUMN_COUNT
    const rowCount = 20
    const cellWidth = size / columnCount
    const cellHeight = size / rowCount

    ctx.strokeStyle = gridColor
    ctx.lineWidth = 2
    for (let i = 0; i <= columnCount; i += 1) {
        const x = i * cellWidth
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, size)
        ctx.stroke()
    }
    for (let j = 0; j <= rowCount; j += 1) {
        const y = j * cellHeight
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(size, y)
        ctx.stroke()
    }

    ctx.fillStyle = letterColor
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold 40px monospace'

    for (let col = 0; col < columnCount; col += 1) {
        const columnOffset = (col * 7) % LONG_TEXT.length
        for (let row = 0; row < rowCount; row += 1) {
            const index = (columnOffset + row) % LONG_TEXT.length
            const char = LONG_TEXT[index]
            const cx = col * cellWidth + cellWidth / 2
            const cy = row * cellHeight + cellHeight / 2
            ctx.fillText(char, cx, cy)
        }
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    texture.needsUpdate = true
    return texture
}

const SPHERE_COLUMN_COUNT = 32
const texture = createGridTexture(renderer)
texture.wrapS = THREE.RepeatWrapping
texture.wrapT = THREE.RepeatWrapping
texture.repeat.set(1, 1)
texture.offset.set(1 / (SPHERE_COLUMN_COUNT * 2), 0)

const sphereTextureScrollSpeed = 0.04
const sphereAutoScrollSpeed = -sphereTextureScrollSpeed
const sphereDragSpeedFactor = 0.1
const sphereMaxDragSpeed = 0.2
const sphereSlowdownTime = 0.3
const sphereResumeTime = 2.0
const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 64),
    new THREE.MeshStandardMaterial({
        map: texture,
        ...baseMaterialParams
    })
)
sphere.position.y = -0.5
scene.add(sphere)

const planeMaterial = plane.material as THREE.MeshStandardMaterial
const sphereMaterial = sphere.material as THREE.MeshStandardMaterial
planeMaterial.color.copy(sphereMaterial.color)
planeMaterial.roughness = sphereMaterial.roughness
planeMaterial.metalness = sphereMaterial.metalness
planeMaterial.color.set(0x000000)

const sphereRaycaster = new THREE.Raycaster()
const spherePointer = new THREE.Vector2()
let isSpherePointerDown = false
let lastPointerY = 0
let lastPointerTime = 0
let currentScrollSpeed = sphereAutoScrollSpeed
let targetScrollSpeed = sphereAutoScrollSpeed
let currentBaseSpeed = sphereAutoScrollSpeed

renderer.domElement.addEventListener('pointerdown', (event) => {
    spherePointer.x = (event.clientX / window.innerWidth) * 2 - 1
    spherePointer.y = -(event.clientY / window.innerHeight) * 2 + 1
    sphereRaycaster.setFromCamera(spherePointer, camera)
    const hit = sphereRaycaster.intersectObject(sphere, false)
    if (hit.length === 0) {
        return
    }
    isSpherePointerDown = true
    currentBaseSpeed = 0
    lastPointerY = event.clientY
    lastPointerTime = performance.now()
    renderer.domElement.setPointerCapture(event.pointerId)
})

renderer.domElement.addEventListener('pointermove', (event) => {
    if (!isSpherePointerDown) {
        return
    }
    const now = performance.now()
    const deltaY = event.clientY - lastPointerY
    const deltaTime = Math.max(8, now - lastPointerTime)
    lastPointerY = event.clientY
    lastPointerTime = now
    const velocity = deltaY / deltaTime
    const impulse = THREE.MathUtils.clamp(
        velocity * sphereDragSpeedFactor,
        -sphereMaxDragSpeed,
        sphereMaxDragSpeed
    )
    currentScrollSpeed = THREE.MathUtils.clamp(
        currentScrollSpeed + impulse,
        -sphereMaxDragSpeed,
        sphereMaxDragSpeed
    )
})

renderer.domElement.addEventListener('pointerup', (event) => {
    if (!isSpherePointerDown) {
        return
    }
    isSpherePointerDown = false
    currentBaseSpeed = sphereAutoScrollSpeed
    renderer.domElement.releasePointerCapture(event.pointerId)
})

renderer.domElement.addEventListener('pointercancel', (event) => {
    if (!isSpherePointerDown) {
        return
    }
    isSpherePointerDown = false
    currentBaseSpeed = sphereAutoScrollSpeed
    renderer.domElement.releasePointerCapture(event.pointerId)
})


function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', onResize)

function animate() {
    requestAnimationFrame(animate)
    const delta = clock.getDelta()
    sphere.rotation.y = 0
    sphere.rotation.x = 0

    targetScrollSpeed = currentBaseSpeed

    const timeConstant =
        targetScrollSpeed === 0 ? sphereSlowdownTime : sphereResumeTime
    const smoothing = 1 - Math.exp(-delta / timeConstant)
    currentScrollSpeed += (targetScrollSpeed - currentScrollSpeed) * smoothing

    texture.offset.y = (texture.offset.y + currentScrollSpeed * delta + 1) % 1

    flowOffset = (flowOffset + gridFlowSpeed * delta) % half

    letterCtx.clearRect(0, 0, letterCanvasSize, letterCanvasSize)
    letterCtx.strokeStyle = gridColor
    letterCtx.lineWidth = 2

    const center = letterCanvasSize / 2
    for (let ring = 1; ring <= radialCount; ring += 1) {
        const radius = wrapRadius(ring * ringStep, flowOffset)
        if (radius <= sinkRadius) {
            continue
        }
        const pr = (radius / half) * center
        letterCtx.beginPath()
        letterCtx.arc(center, center, pr, 0, Math.PI * 2)
        letterCtx.stroke()
    }

    for (let angle = 0; angle < angularCount; angle += 1) {
        const theta = angle * angleStep
        const x = center + Math.cos(theta) * center
        const y = center + Math.sin(theta) * center
        letterCtx.beginPath()
        letterCtx.moveTo(center, center)
        letterCtx.lineTo(x, y)
        letterCtx.stroke()
    }

    letterCtx.textAlign = 'center'
    letterCtx.textBaseline = 'middle'
    letterCtx.font = 'bold 48px monospace'

    for (const cell of letterCells) {
        const radius = wrapRadius((cell.ringIndex + 0.5) * ringStep, flowOffset)
        if (radius <= sinkRadius) {
            continue
        }

        const theta = (cell.angleIndex + 0.5) * angleStep
        const x = radius * Math.cos(theta)
        const y = radius * Math.sin(theta)

        const t = Math.min(
            1,
            Math.max(0, (radius - fadeEnd) / (fadeStart - fadeEnd))
        )
        const alpha = t
        const size = 18 + 6 * t

        const u = (x + half) / planeSize
        const v = (y + half) / planeSize
        const px = u * letterCanvasSize
        const py = (1 - v) * letterCanvasSize

        const angleScreen = Math.atan2(y, -x)
        const scaledAlpha = letterFillAlpha * alpha
        letterCtx.fillStyle = `rgba(255,255,255,${scaledAlpha})`
        letterCtx.font = `bold ${size}px monospace`
        letterCtx.save()
        letterCtx.translate(px, py)
        letterCtx.rotate(angleScreen + Math.PI / 2)
        letterCtx.fillText(cell.glyph, 0, 0)
        letterCtx.restore()
    }

    letterTexture.needsUpdate = true
    renderer.render(scene, camera)
}
animate()
