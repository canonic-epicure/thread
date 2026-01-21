/*
    Plane behavior overview:
    - A large plane mesh is created around the sphere and deformed by a Gaussian depression
      centered at the origin, simulating a sink-like hole.
    - A high‑resolution canvas texture is mapped to a plane‑aligned overlay mesh; this overlay
      renders grid rings/spokes and letters in polar coordinates.
    - Letters flow from the edge toward the center by advancing a radial offset each frame.
    - Near the sink, letters fade out smoothly while the sink geometry remains unchanged.
*/
import * as THREE from 'three'

type PlaneControllerOptions = {
    renderer: THREE.WebGLRenderer
    materialParams: {
        color: number
        roughness: number
        metalness: number
    }
    planeColor: number
    gridColor: string
    letterFillAlpha: number
}

type PlaneController = {
    plane: THREE.Mesh
    planeMaterial: THREE.MeshStandardMaterial
    updatePlane: (delta: number) => void
}

type LetterCell = {
    ringIndex: number
    angleIndex: number
    glyph: string
}

const PLANE_SIZE = 25
const PLANE_SEGMENTS = 200
const DEPRESSION_RADIUS = 3.1
const DEPRESSION_DEPTH = 15.4
const DEPRESSION_FALLOFF = 18

const RADIAL_COUNT = 48
const ANGULAR_COUNT = 48
const SINK_RADIUS = 0.8
const FADE_START = 1.6
const FADE_END = 0.3
const GRID_FLOW_SPEED = 0.1
const LETTER_CANVAS_SIZE = 4096

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function getPlaneHeightAt(x: number, y: number): number {
    const r = Math.hypot(x, y)
    if (r > DEPRESSION_RADIUS) {
        return 0
    }
    const rNorm = r / DEPRESSION_RADIUS
    return -DEPRESSION_DEPTH * Math.exp(-DEPRESSION_FALLOFF * rNorm * rNorm)
}

// Creates a plane geometry and applies the depression by moving vertices downwards.
function createDepressedPlane(materialParams: PlaneControllerOptions['materialParams']): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, PLANE_SEGMENTS, PLANE_SEGMENTS)
    const position = geometry.attributes.position

    for (let i = 0; i < position.count; i += 1) {
        const x = position.getX(i)
        const y = position.getY(i)
        position.setZ(i, getPlaneHeightAt(x, y))
    }

    geometry.computeVertexNormals()

    const material = new THREE.MeshStandardMaterial({
        ...materialParams,
        transparent: true,
        side: THREE.DoubleSide
    })

    const plane = new THREE.Mesh(geometry, material)
    plane.position.set(0, 0, 0)
    plane.rotation.x = -1.3
    plane.rotation.y = 0
    return plane
}

function wrapRadius(radius: number, offset: number, half: number): number {
    let shifted = radius - offset
    shifted = ((shifted % half) + half) % half
    if (shifted < 0.01) {
        shifted += half
    }
    return shifted
}

// Precompute a polar grid of cells so letters stay aligned to rings/spokes.
function createLetterCells(): LetterCell[] {
    const cells: LetterCell[] = []
    let index = 0
    for (let ring = 0; ring < RADIAL_COUNT; ring += 1) {
        for (let angle = 0; angle < ANGULAR_COUNT; angle += 1) {
            cells.push({
                ringIndex: ring,
                angleIndex: angle,
                glyph: LETTERS[index % LETTERS.length]
            })
            index += 1
        }
    }
    return cells
}

export function createPlaneController(options: PlaneControllerOptions): PlaneController {
    const { renderer, materialParams, planeColor, gridColor, letterFillAlpha } = options

    const plane = createDepressedPlane(materialParams)

    const half = PLANE_SIZE / 2
    const ringStep = half / RADIAL_COUNT
    const angleStep = (Math.PI * 2) / ANGULAR_COUNT
    const letterCells = createLetterCells()

    // Overlay texture: renders the moving grid and letters on top of the plane mesh.
    const letterCanvas = document.createElement('canvas')
    letterCanvas.width = LETTER_CANVAS_SIZE
    letterCanvas.height = LETTER_CANVAS_SIZE
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
            ...materialParams
        })
    )
    letterOverlay.renderOrder = 1
    plane.add(letterOverlay)

    const planeMaterial = plane.material as THREE.MeshStandardMaterial
    planeMaterial.color.set(planeColor)
    let flowOffset = 0

    // Draws the rings/spokes and letters each frame based on the flowing radius offset.
    const updatePlane = (delta: number) => {
        flowOffset = (flowOffset + GRID_FLOW_SPEED * delta) % half

        letterCtx.clearRect(0, 0, LETTER_CANVAS_SIZE, LETTER_CANVAS_SIZE)
        letterCtx.strokeStyle = gridColor
        letterCtx.lineWidth = 2

        const center = LETTER_CANVAS_SIZE / 2
        for (let ring = 1; ring <= RADIAL_COUNT; ring += 1) {
            const radius = wrapRadius(ring * ringStep, flowOffset, half)
            if (radius <= SINK_RADIUS) {
                continue
            }
            const pr = (radius / half) * center
            letterCtx.beginPath()
            letterCtx.arc(center, center, pr, 0, Math.PI * 2)
            letterCtx.stroke()
        }

        for (let angle = 0; angle < ANGULAR_COUNT; angle += 1) {
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
            const radius = wrapRadius((cell.ringIndex + 0.5) * ringStep, flowOffset, half)
            if (radius <= SINK_RADIUS) {
                continue
            }

            const theta = (cell.angleIndex + 0.5) * angleStep
            const x = radius * Math.cos(theta)
            const y = radius * Math.sin(theta)

            const t = Math.min(
                1,
                Math.max(0, (radius - FADE_END) / (FADE_START - FADE_END))
            )
            const size = 18 + 6 * t

            const u = (x + half) / PLANE_SIZE
            const v = (y + half) / PLANE_SIZE
            const px = u * LETTER_CANVAS_SIZE
            const py = (1 - v) * LETTER_CANVAS_SIZE

            const angleScreen = Math.atan2(y, -x)
            const scaledAlpha = letterFillAlpha * t * t * t * t
            letterCtx.fillStyle = `rgba(255,255,255,${scaledAlpha})`
            letterCtx.font = `bold ${size}px monospace`
            letterCtx.save()
            letterCtx.translate(px, py)
            letterCtx.rotate(angleScreen + Math.PI / 2)
            letterCtx.fillText(cell.glyph, 0, 0)
            letterCtx.restore()
        }

        letterTexture.needsUpdate = true
    }

    return { plane, planeMaterial, updatePlane }
}
