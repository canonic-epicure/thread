import * as THREE from 'three'

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
    updateSpiral: (delta: number) => void
}

const PLANE_SIZE = 25
const PLANE_SEGMENTS = 350
const DEPRESSION_RADIUS = 3.1
const DEPRESSION_DEPTH = 15.4
const DEPRESSION_FALLOFF = 18

const SPIRAL_TURNS = 51
const SPIRAL_FLOW_SPEED = 0.0003
const SPIRAL_LETTER_COUNT = SPIRAL_TURNS * 100
const SPIRAL_TEXT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SPIRAL_ALPHA_EDGE = 0
const SPIRAL_ALPHA_CENTER = 1.0

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

    const updateSpiral = (delta: number) => {
        spiralProgress = (spiralProgress + SPIRAL_FLOW_SPEED * delta) % 1
        spiralCtx.clearRect(0, 0, spiralCanvas.width, spiralCanvas.height)

        spiralCtx.imageSmoothingEnabled = false
        spiralCtx.textAlign = 'center'
        spiralCtx.textBaseline = 'middle'
        spiralCtx.font = 'bold 18px monospace'

        for (let i = 0; i < SPIRAL_LETTER_COUNT; i += 1) {
            const t = (i / SPIRAL_LETTER_COUNT + spiralProgress) % 1
            const radius = half - t * (half - 0.2)
            const angle = SPIRAL_TURNS * Math.PI * 2 * t
            const x = radius * Math.cos(angle)
            const y = radius * Math.sin(angle)

            const u = (x + half) / PLANE_SIZE
            const v = (y + half) / PLANE_SIZE
            const px = u * spiralCanvas.width
            const py = (1 - v) * spiralCanvas.height

            const char = SPIRAL_TEXT[i % SPIRAL_TEXT.length]
            const edgeT = Math.min(1, Math.max(0, radius / half))
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
