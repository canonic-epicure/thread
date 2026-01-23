import * as THREE from 'three'
import { LONG_TEXT, TEXT } from './text'

type SpiralControllerOptions = {
    renderer: THREE.WebGLRenderer
    materialParams: {
        color: number
        roughness: number
        metalness: number
    }
    planeColor: number
    letterColor: number
    fontFamily: string
}

type SpiralController = {
    spiralPlane: THREE.Mesh
    updateSpiral: (
        delta: number,
        sphereState: { isPointerDown: boolean; scrollSpeed: number }
    ) => void
    setSpiralPlaneColor: (color: string | number) => void
    setSpiralLetterColor: (color: string | number) => void
    setSpiralFont: (fontFamily: string) => void
}

const PLANE_SIZE = 15
const PLANE_SEGMENTS = 350
const DEPRESSION_RADIUS = 3.1
const DEPRESSION_DEPTH = 15.4
const DEPRESSION_FALLOFF = 18

const SPIRAL_TURNS = 51
const SPIRAL_FLOW_SPEED = 0.0002
const SPIRAL_LETTER_COUNT = SPIRAL_TURNS * 91 + 15
const SPIRAL_ALPHA_EDGE = 0
const SPIRAL_ALPHA_CENTER = 1.0

const SPIRAL_RETURN_DELAY = 0.6
const SPIRAL_RETURN_DURATION = 7
const SPIRAL_RELEASE_DURATION = 7
const SPIRAL_STOP_THRESHOLD = 0.01

const PLANE_PARTICLE_COUNT = 30
const PLANE_PARTICLE_SPEED_MIN = 0.6
const PLANE_PARTICLE_SPEED_MAX = 1.6
const PLANE_PARTICLE_LIFE_MIN = 0.35
const PLANE_PARTICLE_LIFE_MAX = 1.35
const PLANE_PARTICLE_TRAIL_SECONDS = 0.08
const PLANE_PARTICLE_EDGE_PADDING = 0.1
const PLANE_PARTICLE_HEIGHT_OFFSET = 0.003
const PLANE_PARTICLE_WIDTH = 0.01

const PLANE_FADE_RESOLUTION = 512
const PLANE_FADE_INNER = 0.12
const PLANE_FADE_OUTER = 0.85

const PLANE_LENS_COUNT = 5
const PLANE_LENS_RADIUS_MIN = 0.2
const PLANE_LENS_RADIUS_MAX = 1
const PLANE_LENS_STRENGTH_MIN = 0.09
const PLANE_LENS_STRENGTH_MAX = 0.18
const PLANE_LENS_SPEED_MIN = 0.05
const PLANE_LENS_SPEED_MAX = 0.25
const PLANE_LENS_BOUNDS_SCALE = 0.5
const PLANE_LENS_LIFE_MIN = 3.5
const PLANE_LENS_LIFE_MAX = 7.5
const PLANE_LENS_FADE_IN = 0.5
const PLANE_LENS_FADE_OUT = 0.5

type SpiralSlot = {
    char: string
    originalIndex: number
    alteredIndex: number
    displacedIndex: number
}

type GlyphAtlas = {
    texture: THREE.CanvasTexture
    glyphMap: Map<string, number>
    columns: number
    rows: number
}

type PlaneParticle = {
    pos: THREE.Vector2
    vel: THREE.Vector2
    speed: number
    age: number
    life: number
}

type PlaneLens = {
    pos: THREE.Vector2
    vel: THREE.Vector2
    radius: number
    baseStrength: number
    baseSpeed: number
    age: number
    life: number
}

type PlaneLensVisual = {
    object: THREE.Mesh
    update: (lenses: PlaneLens[]) => void
}

const SPIRAL_TEXT_CHARS = Array.from(LONG_TEXT)
const SPIRAL_STRING_OFFSET_RADIUS = 15
const SPIRAL_OFFSET_RANGE = SPIRAL_STRING_OFFSET_RADIUS * 2 + 1
const SPIRAL_OFFSET_STD_DEV = SPIRAL_STRING_OFFSET_RADIUS * 0.6

const GLYPH_CELL_SIZE = 64
const GLYPH_FONT_SIZE = 64
const GLYPH_ATLAS_COLUMNS = 16
const LETTER_SIZE = (PLANE_SIZE * 18) / 4096

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

function createGlyphAtlas(chars: string[], fontFamily: string): GlyphAtlas {
    const uniqueChars = Array.from(new Set(chars))
    if (!uniqueChars.includes(' ')) {
        uniqueChars.push(' ')
    }

    const columns = GLYPH_ATLAS_COLUMNS
    const rows = Math.ceil(uniqueChars.length / columns)
    const canvas = document.createElement('canvas')
    canvas.width = columns * GLYPH_CELL_SIZE
    canvas.height = rows * GLYPH_CELL_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        throw new Error('Failed to get glyph atlas context')
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'white'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `bold ${GLYPH_FONT_SIZE}px ${fontFamily}`

    const glyphMap = new Map<string, number>()
    uniqueChars.forEach((char, index) => {
        const col = index % columns
        const row = Math.floor(index / columns)
        const cx = col * GLYPH_CELL_SIZE + GLYPH_CELL_SIZE / 2
        const cy = row * GLYPH_CELL_SIZE + GLYPH_CELL_SIZE / 2
        ctx.fillText(char, cx, cy)
        glyphMap.set(char, index)
    })

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true

    return { texture, glyphMap, columns, rows }
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

    const alphaMap = createPlaneAlphaMap()
    const material = new THREE.MeshStandardMaterial({
        ...materialParams,
        color: planeColor,
        transparent: true,
        depthWrite: true,
        alphaMap,
        alphaTest: 0,
        side: THREE.FrontSide
    })

    const plane = new THREE.Mesh(geometry, material)
    plane.position.set(0, 0, 0)
    plane.rotation.x = -1.3
    plane.rotation.y = 0
    return plane
}

function createPlaneAlphaMap(): THREE.CanvasTexture {
    const size = PLANE_FADE_RESOLUTION
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        throw new Error('Failed to get plane alpha map context')
    }

    const center = size / 2
    const radius = center
    const gradient = ctx.createRadialGradient(
        center,
        center,
        radius * PLANE_FADE_INNER,
        center,
        center,
        radius * PLANE_FADE_OUTER
    )
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true
    return texture
}

function createPlaneParticles(half: number): {
    object: THREE.Mesh
    update: (delta: number) => void
} {
    const particles: PlaneParticle[] = []
    const baseQuad = new THREE.PlaneGeometry(1, 1)
    const geometry = new THREE.InstancedBufferGeometry()
    geometry.index = baseQuad.index
    geometry.attributes.position = baseQuad.attributes.position
    geometry.attributes.uv = baseQuad.attributes.uv
    geometry.instanceCount = PLANE_PARTICLE_COUNT

    const tailArray = new Float32Array(PLANE_PARTICLE_COUNT * 3)
    const headArray = new Float32Array(PLANE_PARTICLE_COUNT * 3)
    const alphaArray = new Float32Array(PLANE_PARTICLE_COUNT * 2)
    const widthArray = new Float32Array(PLANE_PARTICLE_COUNT)
    geometry.setAttribute('aTail', new THREE.InstancedBufferAttribute(tailArray, 3))
    geometry.setAttribute('aHead', new THREE.InstancedBufferAttribute(headArray, 3))
    geometry.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(alphaArray, 2))
    geometry.setAttribute('aWidth', new THREE.InstancedBufferAttribute(widthArray, 1))

    const material = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        uniforms: {
            uColor: { value: new THREE.Color(0.85, 0.92, 1.0) }
        },
        vertexShader: `
            attribute vec3 aTail;
            attribute vec3 aHead;
            attribute vec2 aAlpha;
            attribute float aWidth;
            uniform vec3 uColor;
            varying vec4 vColor;

            void main() {
                vec3 dir = aHead - aTail;
                float len = length(dir);
                vec3 dirNorm = len > 0.0001 ? dir / len : vec3(1.0, 0.0, 0.0);
                vec3 right = normalize(cross(vec3(0.0, 0.0, 1.0), dirNorm));
                vec3 center = (aHead + aTail) * 0.5;
                vec3 offset = dirNorm * (position.x * len) + right * (position.y * aWidth);
                float t = position.x + 0.5;
                float alpha = mix(aAlpha.x, aAlpha.y, t);
                vColor = vec4(uColor, alpha);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(center + offset, 1.0);
            }
        `,
        fragmentShader: `
            varying vec4 vColor;
            void main() {
                if (vColor.a < 0.01) {
                    discard;
                }
                gl_FragColor = vColor;
            }
        `
    })

    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.renderOrder = 1

    const spawnParticle = (particle: PlaneParticle) => {
        const range = half - PLANE_PARTICLE_EDGE_PADDING
        particle.pos.set(
            THREE.MathUtils.randFloatSpread(range * 2),
            THREE.MathUtils.randFloatSpread(range * 2)
        )
        const angle = Math.random() * Math.PI * 2
        particle.vel.set(Math.cos(angle), Math.sin(angle))
        particle.speed = THREE.MathUtils.lerp(
            PLANE_PARTICLE_SPEED_MIN,
            PLANE_PARTICLE_SPEED_MAX,
            Math.random()
        )
        particle.age = 0
        particle.life = THREE.MathUtils.lerp(
            PLANE_PARTICLE_LIFE_MIN,
            PLANE_PARTICLE_LIFE_MAX,
            Math.random()
        )
    }

    for (let i = 0; i < PLANE_PARTICLE_COUNT; i += 1) {
        const particle: PlaneParticle = {
            pos: new THREE.Vector2(),
            vel: new THREE.Vector2(1, 0),
            speed: 0,
            age: 0,
            life: 1
        }
        spawnParticle(particle)
        particles.push(particle)
    }

    const update = (delta: number) => {
        const range = half + PLANE_PARTICLE_EDGE_PADDING
        for (let i = 0; i < particles.length; i += 1) {
            const particle = particles[i]
            particle.age += delta
            if (
                particle.age >= particle.life ||
                Math.abs(particle.pos.x) > range ||
                Math.abs(particle.pos.y) > range
            ) {
                spawnParticle(particle)
            }

            const step = particle.speed * delta
            particle.pos.x += particle.vel.x * step
            particle.pos.y += particle.vel.y * step

            const lifeT = THREE.MathUtils.clamp(1 - particle.age / particle.life, 0, 1)
            const alphaHead = 0.7 * lifeT
            const alphaTail = 0.0
            const trail = Math.max(0.01, particle.speed * PLANE_PARTICLE_TRAIL_SECONDS)
            const tailX = particle.pos.x - particle.vel.x * trail
            const tailY = particle.pos.y - particle.vel.y * trail

            const zHead = getPlaneHeightAt(particle.pos.x, particle.pos.y) + PLANE_PARTICLE_HEIGHT_OFFSET
            const zTail = getPlaneHeightAt(tailX, tailY) + PLANE_PARTICLE_HEIGHT_OFFSET

            const tailIndex = i * 3
            tailArray[tailIndex] = tailX
            tailArray[tailIndex + 1] = tailY
            tailArray[tailIndex + 2] = zTail
            headArray[tailIndex] = particle.pos.x
            headArray[tailIndex + 1] = particle.pos.y
            headArray[tailIndex + 2] = zHead

            const alphaIndex = i * 2
            alphaArray[alphaIndex] = alphaTail
            alphaArray[alphaIndex + 1] = alphaHead
            widthArray[i] = PLANE_PARTICLE_WIDTH
        }

        geometry.attributes.aTail.needsUpdate = true
        geometry.attributes.aHead.needsUpdate = true
        geometry.attributes.aAlpha.needsUpdate = true
        geometry.attributes.aWidth.needsUpdate = true
    }

    return { object: mesh, update }
}


export function createSpiralController(options: SpiralControllerOptions): SpiralController {
    const plane = createDepressedPlane(options.materialParams, options.planeColor)
    const planeMaterial = plane.material as THREE.MeshStandardMaterial
    const half = PLANE_SIZE / 2
    const radialStep = half
    const particleSystem = createPlaneParticles(half)
    particleSystem.object.renderOrder = 1
    plane.add(particleSystem.object)
    // Lens visuals removed; keep only letter distortion.
    const spiralCharGenerator = createSpiralCharGenerator(SPIRAL_TEXT_CHARS)
    const spiralSlots = createSpiralSlots(spiralCharGenerator)
    assignDisplacedIndices(spiralSlots)

    let currentFontFamily = options.fontFamily
    let glyphAtlas = createGlyphAtlas(Array.from(TEXT), currentFontFamily)
    glyphAtlas.texture.anisotropy = Math.min(
        8,
        options.renderer.capabilities.getMaxAnisotropy()
    )
    const total = SPIRAL_LETTER_COUNT
    const originalTArray = new Float32Array(total)
    const displacedTArray = new Float32Array(total)
    const glyphUvArray = new Float32Array(total * 2)
    let fallbackGlyph = glyphAtlas.glyphMap.get(' ') ?? 0

    for (let i = 0; i < total; i += 1) {
        const slot = spiralSlots[i]
        originalTArray[i] = slot.originalIndex / total
        displacedTArray[i] = slot.displacedIndex / total
        const glyphIndex = glyphAtlas.glyphMap.get(slot.char) ?? fallbackGlyph
        glyphUvArray[i * 2] = glyphIndex % glyphAtlas.columns
        glyphUvArray[i * 2 + 1] = Math.floor(glyphIndex / glyphAtlas.columns)
    }

    const baseGeometry = new THREE.PlaneGeometry(1, 1)
    const spiralGeometry = new THREE.InstancedBufferGeometry()
    spiralGeometry.index = baseGeometry.index
    spiralGeometry.attributes.position = baseGeometry.attributes.position
    spiralGeometry.attributes.uv = baseGeometry.attributes.uv
    spiralGeometry.instanceCount = total
    spiralGeometry.setAttribute(
        'aOriginalT',
        new THREE.InstancedBufferAttribute(originalTArray, 1)
    )
    spiralGeometry.setAttribute(
        'aDisplacedT',
        new THREE.InstancedBufferAttribute(displacedTArray, 1)
    )
    const glyphAttribute = new THREE.InstancedBufferAttribute(glyphUvArray, 2)
    glyphAttribute.setUsage(THREE.DynamicDrawUsage)
    spiralGeometry.setAttribute('aGlyphUv', glyphAttribute)

    const spiralMaterial = new THREE.ShaderMaterial({
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
            uSpiralProgress: { value: 0 },
            uBlend: { value: 0 },
            uPlaneHalf: { value: half },
            uRadialStep: { value: radialStep },
            uSpiralTurns: { value: SPIRAL_TURNS },
            uLetterSize: { value: LETTER_SIZE },
            uDepressionRadius: { value: DEPRESSION_RADIUS },
            uDepressionDepth: { value: DEPRESSION_DEPTH },
            uDepressionFalloff: { value: DEPRESSION_FALLOFF },
            uAtlas: { value: glyphAtlas.texture },
            uAtlasGrid: { value: new THREE.Vector2(glyphAtlas.columns, glyphAtlas.rows) },
            uLetterColor: { value: new THREE.Color(options.letterColor) },
            uAlphaEdge: { value: SPIRAL_ALPHA_EDGE },
            uAlphaCenter: { value: SPIRAL_ALPHA_CENTER },
            uDebugSolid: { value: 0 },
            uLensCount: { value: 0 },
            uLensPos: { value: Array.from({ length: PLANE_LENS_COUNT }, () => new THREE.Vector2()) },
            uLensRadius: { value: new Array(PLANE_LENS_COUNT).fill(0) },
            uLensStrength: { value: new Array(PLANE_LENS_COUNT).fill(0) }
        },
        vertexShader: `
            attribute float aOriginalT;
            attribute float aDisplacedT;
            attribute vec2 aGlyphUv;

            uniform float uSpiralProgress;
            uniform float uBlend;
            uniform float uPlaneHalf;
            uniform float uRadialStep;
            uniform float uSpiralTurns;
            uniform float uLetterSize;
            uniform float uDepressionRadius;
            uniform float uDepressionDepth;
            uniform float uDepressionFalloff;
            uniform float uAlphaEdge;
            uniform float uAlphaCenter;
            uniform float uDebugSolid;
            uniform int uLensCount;
            uniform vec2 uLensPos[${PLANE_LENS_COUNT}];
            uniform float uLensRadius[${PLANE_LENS_COUNT}];
            uniform float uLensStrength[${PLANE_LENS_COUNT}];

            varying vec2 vUv;
            varying vec2 vGlyphUv;
            varying float vEdgeAlpha;

            const float PI = 3.141592653589793;

            float planeHeight(vec2 pos) {
                float r = length(pos);
                if (r > uDepressionRadius) {
                    return 0.0;
                }
                float rNorm = r / uDepressionRadius;
                return -uDepressionDepth * exp(-uDepressionFalloff * rNorm * rNorm);
            }

            vec3 planeNormal(vec2 pos) {
                float r = length(pos);
                if (r < 0.0001 || r > uDepressionRadius) {
                    return vec3(0.0, 0.0, 1.0);
                }
                float rNorm = r / uDepressionRadius;
                float expTerm = exp(-uDepressionFalloff * rNorm * rNorm);
                float dhdr = uDepressionDepth * expTerm * (2.0 * uDepressionFalloff * r) /
                    (uDepressionRadius * uDepressionRadius);
                vec2 grad = (pos / r) * dhdr;
                return normalize(vec3(-grad.x, -grad.y, 1.0));
            }

            void main() {
                if (uDebugSolid > 1.5) {
                    vec2 pos = vec2(0.0);
                    vec2 quad = position.xy * uLetterSize * 20.0;
                    vec3 finalPos = vec3(pos + quad, 0.05);
                    vEdgeAlpha = 1.0;
                    vUv = uv;
                    vGlyphUv = aGlyphUv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
                    return;
                }

                float tOriginal = aOriginalT + uSpiralProgress;
                tOriginal = tOriginal - floor(tOriginal);
                float tDisplaced = aDisplacedT + uSpiralProgress;
                tDisplaced = tDisplaced - floor(tDisplaced);

                float radiusOriginal = uPlaneHalf - tOriginal * uRadialStep;
                float angleOriginal = uSpiralTurns * 2.0 * PI * tOriginal;
                vec2 originalPos = vec2(cos(angleOriginal), sin(angleOriginal)) * radiusOriginal;

                float radiusDisplaced = uPlaneHalf - tDisplaced * uRadialStep;
                float angleDisplaced = uSpiralTurns * 2.0 * PI * tDisplaced;
                vec2 displacedPos = vec2(cos(angleDisplaced), sin(angleDisplaced)) * radiusDisplaced;

                vec2 pos = mix(displacedPos, originalPos, uBlend);
                for (int i = 0; i < ${PLANE_LENS_COUNT}; i += 1) {
                    if (i >= uLensCount) {
                        break;
                    }
                    vec2 delta = pos - uLensPos[i];
                    float dist = length(delta);
                    float radius = uLensRadius[i];
                    if (dist < radius) {
                        float t = 1.0 - (dist / radius);
                        float falloff = t * t * (3.0 - 2.0 * t);
                        vec2 dir = dist > 0.0001 ? (delta / dist) : vec2(1.0, 0.0);
                        pos += dir * uLensStrength[i] * falloff;
                    }
                }

                vec2 quad = position.xy * uLetterSize;
                vec3 normal = planeNormal(pos);
                vec3 inward = vec3(-pos, 0.0);
                vec3 inwardTangent = inward - normal * dot(inward, normal);
                if (length(inwardTangent) < 0.0001) {
                    inwardTangent = vec3(0.0, 1.0, 0.0);
                } else {
                    inwardTangent = normalize(inwardTangent);
                }
                vec3 rightTangent = normalize(cross(inwardTangent, normal));
                vec3 offset = rightTangent * quad.x + inwardTangent * quad.y;

                float z = planeHeight(pos) + 0.01;
                vec3 finalPos = vec3(pos, z) + offset;

                float edgeT = clamp(length(pos) / uPlaneHalf, 0.0, 1.0);
                vEdgeAlpha = mix(uAlphaCenter, uAlphaEdge, edgeT);
                vUv = uv;
                vGlyphUv = aGlyphUv;

                gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D uAtlas;
            uniform vec2 uAtlasGrid;
            uniform vec3 uLetterColor;
            uniform float uDebugSolid;

            varying vec2 vUv;
            varying vec2 vGlyphUv;
            varying float vEdgeAlpha;

            void main() {
                float flippedRow = (uAtlasGrid.y - 1.0) - vGlyphUv.y;
                vec2 atlasUv = vec2(
                    (vGlyphUv.x + vUv.x) / uAtlasGrid.x,
                    (flippedRow + vUv.y) / uAtlasGrid.y
                );
                if (uDebugSolid > 0.5) {
                    gl_FragColor = vec4(uLetterColor, 1.0);
                    return;
                }

                vec4 glyphSample = texture2D(uAtlas, atlasUv);
                float glyphAlpha = max(glyphSample.a, glyphSample.r);
                float alpha = glyphAlpha * vEdgeAlpha;
                if (alpha < 0.01) {
                    discard;
                }
                gl_FragColor = vec4(uLetterColor, alpha);
            }
        `
    })

    const spiralOverlay = new THREE.Mesh(spiralGeometry, spiralMaterial)
    spiralOverlay.renderOrder = 2
    spiralOverlay.frustumCulled = false
    plane.add(spiralOverlay)

    let spiralProgress = 0

    let blend = 0
    let blendTarget = 0
    let blendProgress = 0
    let returnDelayRemaining = SPIRAL_RETURN_DELAY
    let lastProgressIndex = 0

    const lensParticles: PlaneLens[] = []
    const lensBounds = half * PLANE_LENS_BOUNDS_SCALE
    const spawnLens = (lens: PlaneLens, randomAge: boolean) => {
        const angle = Math.random() * Math.PI * 2
        lens.pos.set(
            THREE.MathUtils.randFloatSpread(lensBounds),
            THREE.MathUtils.randFloatSpread(lensBounds)
        )
        lens.vel.set(Math.cos(angle), Math.sin(angle))
        lens.radius = THREE.MathUtils.lerp(
            PLANE_LENS_RADIUS_MIN,
            PLANE_LENS_RADIUS_MAX,
            Math.random()
        )
        lens.baseStrength = THREE.MathUtils.lerp(
            PLANE_LENS_STRENGTH_MIN,
            PLANE_LENS_STRENGTH_MAX,
            Math.random()
        )
        lens.baseSpeed = THREE.MathUtils.lerp(
            PLANE_LENS_SPEED_MIN,
            PLANE_LENS_SPEED_MAX,
            Math.random()
        )
        lens.life = THREE.MathUtils.lerp(PLANE_LENS_LIFE_MIN, PLANE_LENS_LIFE_MAX, Math.random())
        lens.age = randomAge ? Math.random() * lens.life : 0
    }

    for (let i = 0; i < PLANE_LENS_COUNT; i += 1) {
        const lens: PlaneLens = {
            pos: new THREE.Vector2(),
            vel: new THREE.Vector2(),
            radius: 0,
            baseStrength: 0,
            baseSpeed: 0,
            age: 0,
            life: 1
        }
        spawnLens(lens, true)
        lensParticles.push(lens)
    }
    spiralMaterial.uniforms.uLensCount.value = PLANE_LENS_COUNT
    const lensPosUniform = spiralMaterial.uniforms.uLensPos.value as THREE.Vector2[]
    const lensRadiusUniform = spiralMaterial.uniforms.uLensRadius.value as number[]
    const lensStrengthUniform = spiralMaterial.uniforms.uLensStrength.value as number[]

    const rebuildGlyphAtlas = () => {
        const nextAtlas = createGlyphAtlas(Array.from(TEXT), currentFontFamily)
        nextAtlas.texture.anisotropy = Math.min(
            8,
            options.renderer.capabilities.getMaxAnisotropy()
        )
        glyphAtlas.texture.dispose()
        glyphAtlas = nextAtlas
        fallbackGlyph = glyphAtlas.glyphMap.get(' ') ?? 0
        spiralMaterial.uniforms.uAtlas.value = glyphAtlas.texture
        spiralMaterial.uniforms.uAtlasGrid.value.set(
            glyphAtlas.columns,
            glyphAtlas.rows
        )
        for (let i = 0; i < total; i += 1) {
            const slot = spiralSlots[i]
            const glyphIndex = glyphAtlas.glyphMap.get(slot.char) ?? fallbackGlyph
            glyphUvArray[i * 2] = glyphIndex % glyphAtlas.columns
            glyphUvArray[i * 2 + 1] = Math.floor(glyphIndex / glyphAtlas.columns)
        }
        glyphAttribute.needsUpdate = true
    }

    const updateSpiral = (
        delta: number,
        sphereState: { isPointerDown: boolean; scrollSpeed: number }
    ) => {
        particleSystem.update(delta)
        for (let i = 0; i < lensParticles.length; i += 1) {
            const lens = lensParticles[i]
            lens.age += delta
            if (lens.age >= lens.life) {
                spawnLens(lens, false)
            }
            const lifeT = lens.life > 0 ? THREE.MathUtils.clamp(lens.age / lens.life, 0, 1) : 1
            const fadeIn = THREE.MathUtils.smoothstep(
                lifeT,
                0,
                PLANE_LENS_FADE_IN
            )
            const fadeOut =
                1 -
                THREE.MathUtils.smoothstep(
                    lifeT,
                    1 - PLANE_LENS_FADE_OUT,
                    1
                )
            const fade = fadeIn * fadeOut
            const speedScale = fade
            lens.pos.x += lens.vel.x * lens.baseSpeed * speedScale * delta
            lens.pos.y += lens.vel.y * lens.baseSpeed * speedScale * delta
            if (lens.pos.x > lensBounds) lens.pos.x = -lensBounds
            if (lens.pos.x < -lensBounds) lens.pos.x = lensBounds
            if (lens.pos.y > lensBounds) lens.pos.y = -lensBounds
            if (lens.pos.y < -lensBounds) lens.pos.y = lensBounds
            lensPosUniform[i].copy(lens.pos)
            lensRadiusUniform[i] = lens.radius
            lensStrengthUniform[i] = lens.baseStrength * fade
        }
        spiralProgress = (spiralProgress + SPIRAL_FLOW_SPEED * delta) % 1
        const progressIndex = Math.floor(spiralProgress * SPIRAL_LETTER_COUNT)
        let glyphsUpdated = false
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
                const nextChar = spiralCharGenerator.next().value ?? ' '
                spiralSlots[slotIndex].char = nextChar
                const glyphIndex =
                    glyphAtlas.glyphMap.get(nextChar) ?? fallbackGlyph
                glyphUvArray[slotIndex * 2] = glyphIndex % glyphAtlas.columns
                glyphUvArray[slotIndex * 2 + 1] = Math.floor(
                    glyphIndex / glyphAtlas.columns
                )
                glyphsUpdated = true
            }
        }

        const isStopped = Math.abs(sphereState.scrollSpeed) <= SPIRAL_STOP_THRESHOLD
        if (sphereState.isPointerDown) {
            returnDelayRemaining = Math.max(0, returnDelayRemaining - delta)
            blendTarget = returnDelayRemaining === 0 ? 1 : 0
        } else {
            returnDelayRemaining = SPIRAL_RETURN_DELAY
            blendTarget = 0
        }

        const duration = blendTarget === 1 ? SPIRAL_RETURN_DURATION : SPIRAL_RELEASE_DURATION
        const step = duration > 0 ? delta / duration : 1
        if (blendTarget === 1) {
            blendProgress = Math.min(1, blendProgress + step)
        } else {
            blendProgress = Math.max(0, blendProgress - step)
        }

        const t = blendProgress
        const eased = t * t * (3 - 2 * t)
        blend = eased

        if (glyphsUpdated) {
            glyphAttribute.needsUpdate = true
        }

        spiralMaterial.uniforms.uSpiralProgress.value = spiralProgress
        spiralMaterial.uniforms.uBlend.value = blend
    }

    return {
        spiralPlane: plane,
        updateSpiral,
        setSpiralPlaneColor: (color: string | number) => {
            planeMaterial.color.set(color)
        },
        setSpiralLetterColor: (color: string | number) => {
            spiralMaterial.uniforms.uLetterColor.value.set(color)
        },
        setSpiralFont: (fontFamily: string) => {
            currentFontFamily = fontFamily
            rebuildGlyphAtlas()
        }
    }
}
