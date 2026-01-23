import * as THREE from 'three'
import { LONG_TEXT } from './text'

type SpiralControllerOptions = {
    renderer: THREE.WebGLRenderer
    materialParams: {
        color: number
        roughness: number
        metalness: number
    }
    planeColor: number
    letterColor: number
}

type SpiralController = {
    spiralPlane: THREE.Mesh
    updateSpiral: (
        delta: number,
        sphereState: { isPointerDown: boolean; scrollSpeed: number }
    ) => void
}

const PLANE_SIZE = 25
const PLANE_SEGMENTS = 350
const DEPRESSION_RADIUS = 3.1
const DEPRESSION_DEPTH = 15.4
const DEPRESSION_FALLOFF = 18

const SPIRAL_TURNS = 51
const SPIRAL_FLOW_SPEED = 0.0003
const SPIRAL_LETTER_COUNT = SPIRAL_TURNS * 100
const SPIRAL_ALPHA_EDGE = 0
const SPIRAL_ALPHA_CENTER = 1.0

const SPIRAL_RETURN_DELAY = 0.6
const SPIRAL_RETURN_DURATION = 5
const SPIRAL_RELEASE_DURATION = 5
const SPIRAL_STOP_THRESHOLD = 0.005

type SpiralSlot = {
    char: string
    originalIndex: number
    alteredIndex: number
    displacedIndex: number
}

const SPIRAL_TEXT_CHARS = Array.from(LONG_TEXT)
const SPIRAL_STRING_OFFSET_RADIUS = 5
const SPIRAL_OFFSET_RANGE = SPIRAL_STRING_OFFSET_RADIUS * 2 + 1
const SPIRAL_OFFSET_STD_DEV = SPIRAL_STRING_OFFSET_RADIUS * 0.9

function* createSpiralCharGenerator(chars: string[]): Generator<string> {
    if (chars.length === 0) {
        while (true) {
            yield ' '
        }
    }

    let index = 0
    while (true) {
        yield chars[index]
        index = (index + 1) % chars.length
    }
}

function sampleGaussianOffset(
    stdDev: number,
    min: number,
    max: number
): number {
    let u = 0
    let v = 0
    while (u === 0) u = Math.random()
    while (v === 0) v = Math.random()
    const gaussian = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    const value = Math.round(gaussian * stdDev)
    return Math.max(min, Math.min(max, value))
}

function createSpiralSlots(generator: Generator<string>): SpiralSlot[] {
    return Array.from({ length: SPIRAL_LETTER_COUNT }, (_, index) => ({
        char: generator.next().value ?? ' ',
        originalIndex: index,
        alteredIndex:
            index +
            sampleGaussianOffset(
                SPIRAL_OFFSET_STD_DEV,
                -SPIRAL_STRING_OFFSET_RADIUS,
                SPIRAL_STRING_OFFSET_RADIUS
            ),
        displacedIndex: 0
    }))
}

function assignDisplacedIndices(slots: SpiralSlot[]): void {
    const displacedOrder = slots
        .slice()
        .sort((a, b) => a.alteredIndex - b.alteredIndex)
    displacedOrder.forEach((slot, index) => {
        slot.displacedIndex = index
    })
}

function getPlaneHeightAt(x: number, y: number): number {
    const r = Math.hypot(x, y)
    if (r > DEPRESSION_RADIUS) {
        return 0
    }
    const rNorm = r / DEPRESSION_RADIUS
    return -DEPRESSION_DEPTH * Math.exp(-DEPRESSION_FALLOFF * rNorm * rNorm)
}

function createDepressedPlane(
    materialParams: SpiralControllerOptions['materialParams'],
    planeColor: number
): THREE.Mesh {
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
        color: planeColor,
        transparent: true,
        side: THREE.DoubleSide
    })

    const plane = new THREE.Mesh(geometry, material)
    plane.position.set(0, 0, 0)
    plane.rotation.x = -1.3
    plane.rotation.y = 0
    return plane
}


export function createSpiralController(options: SpiralControllerOptions): SpiralController {
    const plane = createDepressedPlane(options.materialParams, options.planeColor)
    const spiralCharGenerator = createSpiralCharGenerator(SPIRAL_TEXT_CHARS)
    const spiralSlots = createSpiralSlots(spiralCharGenerator)
    assignDisplacedIndices(spiralSlots)

    const spiralCanvas = document.createElement('canvas')
    spiralCanvas.width = 4096
    spiralCanvas.height = 4096
    const spiralCtx = spiralCanvas.getContext('2d')
    if (!spiralCtx) {
        throw new Error('Failed to get 2D context')
    }

    const spiralTexture = new THREE.CanvasTexture(spiralCanvas)
    spiralTexture.anisotropy = Math.min(
        8,
        options.renderer.capabilities.getMaxAnisotropy()
    )
    spiralTexture.minFilter = THREE.LinearFilter
    spiralTexture.magFilter = THREE.LinearFilter
    spiralTexture.generateMipmaps = false
    spiralTexture.needsUpdate = true

    const spiralOverlay = new THREE.Mesh(
        plane.geometry.clone(),
        new THREE.MeshStandardMaterial({
            map: spiralTexture,
            transparent: true,
            opacity: 1,
            alphaTest: 0.25,
            depthWrite: false,
            ...options.materialParams,
            color: options.letterColor
        })
    )
    spiralOverlay.renderOrder = 2
    plane.add(spiralOverlay)

    let spiralProgress = 0
    const half = PLANE_SIZE / 2

    const letterColor = new THREE.Color(options.letterColor)
    const letterRgb = {
        r: Math.round(letterColor.r * 255),
        g: Math.round(letterColor.g * 255),
        b: Math.round(letterColor.b * 255)
    }

    let blend = 0
    let blendTarget = 0
    let returnDelayRemaining = SPIRAL_RETURN_DELAY
    let lastProgressIndex = 0

    const updateSpiral = (
        delta: number,
        sphereState: { isPointerDown: boolean; scrollSpeed: number }
    ) => {
        spiralProgress = (spiralProgress + SPIRAL_FLOW_SPEED * delta) % 1
        const progressIndex = Math.floor(spiralProgress * SPIRAL_LETTER_COUNT)
        if (progressIndex !== lastProgressIndex) {
            const steps =
                (progressIndex - lastProgressIndex + SPIRAL_LETTER_COUNT) %
                SPIRAL_LETTER_COUNT
            for (let step = 0; step < steps; step += 1) {
                lastProgressIndex =
                    (lastProgressIndex + 1) % SPIRAL_LETTER_COUNT
                const slotIndex =
                    (SPIRAL_LETTER_COUNT - lastProgressIndex) %
                    SPIRAL_LETTER_COUNT
                spiralSlots[slotIndex].char =
                    spiralCharGenerator.next().value ?? ' '
            }
        }

        spiralCtx.clearRect(0, 0, spiralCanvas.width, spiralCanvas.height)

        spiralCtx.imageSmoothingEnabled = false
        spiralCtx.textAlign = 'center'
        spiralCtx.textBaseline = 'middle'
        spiralCtx.font = 'bold 18px monospace'

        if (sphereState.isPointerDown) {
            returnDelayRemaining = Math.max(0, returnDelayRemaining - delta)
            if (returnDelayRemaining === 0) {
                blendTarget = 1
            }
        } else {
            returnDelayRemaining = SPIRAL_RETURN_DELAY
            blendTarget = 0
        }

        const duration = blendTarget === 1 ? SPIRAL_RETURN_DURATION : SPIRAL_RELEASE_DURATION
        const smoothing = 1 - Math.exp(-delta / duration)
        blend += (blendTarget - blend) * smoothing

        const total = SPIRAL_LETTER_COUNT

        for (let i = 0; i < SPIRAL_LETTER_COUNT; i += 1) {
            const entry = spiralSlots[i]
            const tOriginal = (entry.originalIndex / total + spiralProgress) % 1
            const tDisplaced = (entry.displacedIndex / total + spiralProgress) % 1

            const radiusOriginal = half - tOriginal * (half - 0.2)
            const angleOriginal = SPIRAL_TURNS * Math.PI * 2 * tOriginal
            const xOriginal = radiusOriginal * Math.cos(angleOriginal)
            const yOriginal = radiusOriginal * Math.sin(angleOriginal)

            const radiusDisplaced = half - tDisplaced * (half - 0.2)
            const angleDisplaced = SPIRAL_TURNS * Math.PI * 2 * tDisplaced
            const xDisplaced = radiusDisplaced * Math.cos(angleDisplaced)
            const yDisplaced = radiusDisplaced * Math.sin(angleDisplaced)

            const x = xDisplaced + (xOriginal - xDisplaced) * blend
            const y = yDisplaced + (yOriginal - yDisplaced) * blend

            const u = (x + half) / PLANE_SIZE
            const v = (y + half) / PLANE_SIZE
            const px = u * spiralCanvas.width
            const py = (1 - v) * spiralCanvas.height

            const char = entry.char
            const edgeT = Math.min(1, Math.max(0, Math.hypot(x, y) / half))

            const alpha =
                SPIRAL_ALPHA_EDGE +
                (1 - edgeT) * (SPIRAL_ALPHA_CENTER - SPIRAL_ALPHA_EDGE)

            spiralCtx.fillStyle = `rgba(${letterRgb.r}, ${letterRgb.g}, ${letterRgb.b}, ${alpha})`
            spiralCtx.save()
            spiralCtx.translate(px, py)
            spiralCtx.rotate(Math.atan2(y, -x) + Math.PI / 2)
            spiralCtx.fillText(char, 0, 0)
            spiralCtx.restore()
        }

        spiralTexture.needsUpdate = true
    }

    return { spiralPlane: plane, updateSpiral }
}
