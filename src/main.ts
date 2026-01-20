import * as THREE from 'three'
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

const planeSize = 20
const depressionRadius = 2.5
const depressionDepth = 18.4
const depressionFalloff = 9

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
        color: 0x565656,
        roughness: 0.6,
        metalness: 0.1,
        transparent: true,
        alphaMap: createRadialMaskTexture(),
        side: THREE.DoubleSide
    })

    const plane = new THREE.Mesh(geometry, material)
    plane.position.set(0, 0, 0)
    plane.rotation.x = -1
    plane.rotation.y = 0
    return plane
}

const plane = createDepressedPlane()
scene.add(plane)

type LetterCell = {
    x: number
    y: number
    speed: number
    glyph: string
}

const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const gridCount = 24
const gridStep = planeSize / (gridCount - 1)
const half = planeSize / 2
const sinkRadius = 0.8
const fadeStart = 1.6
const fadeEnd = 0.3
const clock = new THREE.Clock()
const letterCells: LetterCell[] = []

const letterCanvas = document.createElement('canvas')
const letterCanvasSize = 2048
letterCanvas.width = letterCanvasSize
letterCanvas.height = letterCanvasSize
const letterCtx = letterCanvas.getContext('2d')
if (!letterCtx) {
    throw new Error('Failed to get 2D context')
}

const letterTexture = new THREE.CanvasTexture(letterCanvas)
letterTexture.needsUpdate = true

const letterOverlay = new THREE.Mesh(
    plane.geometry.clone(),
    new THREE.MeshBasicMaterial({
        map: letterTexture,
        transparent: true,
        opacity: 1,
        depthWrite: false
    })
)
letterOverlay.renderOrder = 1
plane.add(letterOverlay)

function spawnCellAtEdge(cell: LetterCell) {
    const onVerticalEdge = Math.random() < 0.5
    const edgeIndex = Math.floor(Math.random() * gridCount)
    if (onVerticalEdge) {
        cell.x = Math.random() < 0.5 ? -half : half
        cell.y = -half + edgeIndex * gridStep
    } else {
        cell.x = -half + edgeIndex * gridStep
        cell.y = Math.random() < 0.5 ? -half : half
    }
    cell.speed = 0.4 + Math.random() * 0.35
}

function createLetterCells() {
    let index = 0
    for (let y = 0; y < gridCount; y += 1) {
        for (let x = 0; x < gridCount; x += 1) {
            const cell: LetterCell = {
                x: -half + x * gridStep,
                y: -half + y * gridStep,
                speed: 0.4 + Math.random() * 0.35,
                glyph: letters[index % letters.length]
            }
            letterCells.push(cell)
            index += 1
        }
    }
}

createLetterCells()

function createRadialMaskTexture(): THREE.CanvasTexture {
    const size = 512
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        throw new Error('Failed to get 2D context')
    }

    const center = size / 2
    const radius = size / 2
    const gradient = ctx.createRadialGradient(
        center,
        center,
        radius * 0.75,
        center,
        center,
        radius
    )
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
}

function createGridTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
    const size = 1024
    const cells = 10
    const cellSize = size / cells

    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        throw new Error('Failed to get 2D context')
    }

    ctx.clearRect(0, 0, size, size)
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'
    ctx.lineWidth = 2

    for (let i = 0; i <= cells; i += 1) {
        const p = i * cellSize
        ctx.beginPath()
        ctx.moveTo(p, 0)
        ctx.lineTo(p, size)
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(0, p)
        ctx.lineTo(size, p)
        ctx.stroke()
    }

    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    ctx.fillStyle = 'white'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = 'bold 48px monospace'

    let index = 0
    for (let y = 0; y < cells; y += 1) {
        for (let x = 0; x < cells; x += 1) {
            const letter = letters[index % letters.length]
            const cx = x * cellSize + cellSize / 2
            const cy = y * cellSize + cellSize / 2
            ctx.fillText(letter, cx, cy)
            index += 1
        }
    }

    const texture = new THREE.CanvasTexture(canvas)
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
    texture.needsUpdate = true
    return texture
}

const texture = createGridTexture(renderer)
const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 64),
    new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.6,
        metalness: 0.1
    })
)
scene.add(sphere)

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
}
window.addEventListener('resize', onResize)

function animate() {
    requestAnimationFrame(animate)
    const delta = clock.getDelta()
    sphere.rotation.y += 0.003
    sphere.rotation.x += 0.0015

    for (const cell of letterCells) {
        const dist = Math.hypot(cell.x, cell.y)
        if (dist <= sinkRadius) {
            spawnCellAtEdge(cell)
            continue
        }

        const dirX = -cell.x / dist
        const dirY = -cell.y / dist
        cell.x += dirX * cell.speed * delta
        cell.y += dirY * cell.speed * delta
    }

    letterCtx.clearRect(0, 0, letterCanvasSize, letterCanvasSize)
    letterCtx.strokeStyle = 'rgba(255,255,255,0.12)'
    letterCtx.lineWidth = 2

    for (let i = 0; i < gridCount; i += 1) {
        const p = (i / (gridCount - 1)) * letterCanvasSize
        letterCtx.beginPath()
        letterCtx.moveTo(p, 0)
        letterCtx.lineTo(p, letterCanvasSize)
        letterCtx.stroke()

        letterCtx.beginPath()
        letterCtx.moveTo(0, p)
        letterCtx.lineTo(letterCanvasSize, p)
        letterCtx.stroke()
    }

    letterCtx.textAlign = 'center'
    letterCtx.textBaseline = 'middle'
    letterCtx.font = 'bold 48px monospace'

    for (const cell of letterCells) {
        const dist = Math.hypot(cell.x, cell.y)
        if (dist <= sinkRadius) {
            continue
        }

        const t = Math.min(1, Math.max(0, (dist - fadeEnd) / (fadeStart - fadeEnd)))
        const alpha = t
        const size = 40 + 16 * t

        const u = (cell.x + half) / planeSize
        const v = (cell.y + half) / planeSize
        const px = u * letterCanvasSize
        const py = (1 - v) * letterCanvasSize

        letterCtx.fillStyle = `rgba(255,255,255,${alpha})`
        letterCtx.font = `bold ${size}px monospace`
        letterCtx.fillText(cell.glyph, px, py)
    }

    letterTexture.needsUpdate = true
    renderer.render(scene, camera)
}
animate()
