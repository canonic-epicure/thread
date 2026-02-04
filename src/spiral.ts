import * as THREE from 'three'
import type { CharSlot, TextStreamBuffer } from './text-stream.js'
import { GlyphAtlas } from './glyph-atlas.js'
import { createPlaneParticles } from './plane-particles.js'
import {
    createPlaneLenses,
    PLANE_LENS_COUNT
} from './plane-lens.js'

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
    textBuffer: TextStreamBuffer
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

const PLANE_SIZE = 5 // 15
const PLANE_SEGMENTS = 350
const DEPRESSION_RADIUS = 3.1
const DEPRESSION_DEPTH = 15.4
const DEPRESSION_FALLOFF = 18

const SPIRAL_TURNS = 10 //51
const SPIRAL_FLOW_SPEED = 0.001
const SPIRAL_VISIBLE_TEXT_LENGTH = SPIRAL_TURNS * 91 + 15
const SPIRAL_LETTER_COUNT = SPIRAL_VISIBLE_TEXT_LENGTH
const SPIRAL_ALPHA_EDGE = 0
const SPIRAL_ALPHA_CENTER = 1.0

const SPIRAL_RETURN_DELAY = 0.6
const SPIRAL_RETURN_DURATION = 7
const SPIRAL_RELEASE_DURATION = 7

const PLANE_FADE_RESOLUTION = 512
const PLANE_FADE_INNER = 0.12
const PLANE_FADE_OUTER = 0.85

const LETTER_SIZE = (PLANE_SIZE * 18) / 2048 // 4096

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

export function createSpiralController(options: SpiralControllerOptions): SpiralController {
    const plane = createDepressedPlane(options.materialParams, options.planeColor)
    const planeMaterial = plane.material as THREE.MeshStandardMaterial
    const half = PLANE_SIZE / 2
    const radialStep = half
    const particleSystem = createPlaneParticles(half, getPlaneHeightAt)
    particleSystem.object.renderOrder = 1
    plane.add(particleSystem.object)
    // Lens visuals removed; keep only letter distortion.
    const textBuffer = options.textBuffer
    let lastVisibleCount = textBuffer.visibleSlots.length
    let lastVisibleStartAt = textBuffer.visibleStartAt
    let lastUniqueCount = textBuffer.uniqueChars.size
    let needsInitialFill = true

    let currentFontFamily = options.fontFamily
    let glyphAtlas = new GlyphAtlas(currentFontFamily)
    glyphAtlas.ensureChars(Array.from(textBuffer.uniqueChars))
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
        originalTArray[i] = i / total
        displacedTArray[i] = i / total
        const glyphIndex = fallbackGlyph
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
        new THREE.InstancedBufferAttribute(displacedTArray, 1).setUsage(
            THREE.DynamicDrawUsage
        )
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

    spiralMaterial.uniforms.uLensCount.value = PLANE_LENS_COUNT
    const lensPosUniform = spiralMaterial.uniforms.uLensPos.value as THREE.Vector2[]
    const lensRadiusUniform = spiralMaterial.uniforms.uLensRadius.value as number[]
    const lensStrengthUniform = spiralMaterial.uniforms.uLensStrength.value as number[]
    const lensSystem = createPlaneLenses(half, {
        pos: lensPosUniform,
        radius: lensRadiusUniform,
        strength: lensStrengthUniform
    })

    const refreshGlyphAtlas = (chars: string[]) => {
        glyphAtlas.ensureChars(chars)
        fallbackGlyph = glyphAtlas.glyphMap.get(' ') ?? 0
    }

    const rebuildSlice = (startIndex: number, count: number) => {
        const slots = textBuffer.visibleSlots as CharSlot[]
        const startAt = textBuffer.visibleStartAt
        const available = slots.length - startAt
        const pad = Math.max(0, SPIRAL_VISIBLE_TEXT_LENGTH - available)
        for (let i = 0; i < count; i += 1) {
            const slotIndex = (startIndex + i) % total
            let nextChar = ' '
            let displacedIndex = slotIndex
            const bufferIndex = slotIndex - pad
            if (bufferIndex >= 0 && available > 0) {
                const source = slots[startAt + (bufferIndex % available)]
                if (source) {
                    nextChar = source.char
                    const orderedSlot = source.original ?? source
                    const fullIndex = slots.indexOf(orderedSlot)
                    let shuffledIndex = fullIndex - startAt
                    if (fullIndex === -1) {
                        shuffledIndex = bufferIndex % available
                    } else if (shuffledIndex < 0) {
                        shuffledIndex =
                            (shuffledIndex % available + available) % available
                    } else if (shuffledIndex >= available) {
                        shuffledIndex = shuffledIndex % available
                    }
                    displacedIndex =
                        pad + shuffledIndex
                }
            }
            displacedTArray[slotIndex] = displacedIndex / total
            const glyphIndex = glyphAtlas.glyphMap.get(nextChar) ?? fallbackGlyph
            glyphUvArray[slotIndex * 2] = glyphIndex % glyphAtlas.columns
            glyphUvArray[slotIndex * 2 + 1] = Math.floor(
                glyphIndex / glyphAtlas.columns
            )
        }
        glyphAttribute.needsUpdate = true
        spiralGeometry.attributes.aDisplacedT.needsUpdate = true
    }

    const updateSpiral = (
        delta: number,
        sphereState: { isPointerDown: boolean; scrollSpeed: number }
    ) => {
        particleSystem.update(delta)
        let bufferDirty = false
        if (textBuffer.uniqueChars.size !== lastUniqueCount) {
            lastUniqueCount = textBuffer.uniqueChars.size
            refreshGlyphAtlas(Array.from(textBuffer.uniqueChars))
            bufferDirty = true
        }
        if (
            textBuffer.visibleSlots.length !== lastVisibleCount ||
            textBuffer.visibleStartAt !== lastVisibleStartAt
        ) {
            lastVisibleCount = textBuffer.visibleSlots.length
            lastVisibleStartAt = textBuffer.visibleStartAt
            bufferDirty = true
        }
        lensSystem.update(delta)
        if (sphereState.isPointerDown) {
            returnDelayRemaining = Math.max(0, returnDelayRemaining - delta)
            blendTarget = returnDelayRemaining === 0 ? 1 : 0
        } else {
            returnDelayRemaining = SPIRAL_RETURN_DELAY
            blendTarget = 0
        }
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
                textBuffer.shift()
                rebuildSlice(slotIndex, 1)
            }
            lastVisibleCount = textBuffer.visibleSlots.length
            lastVisibleStartAt = textBuffer.visibleStartAt
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

        if (bufferDirty) {
            const dirtyCount = Math.max(lastVisibleCount, lastVisibleStartAt + 1)
            rebuildSlice(0, Math.min(total, dirtyCount))
        }
        if (needsInitialFill) {
            rebuildSlice(0, total)
            needsInitialFill = false
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
            glyphAtlas.setFontFamily(fontFamily)
            glyphAtlas.ensureChars(Array.from(textBuffer.uniqueChars))
            fallbackGlyph = glyphAtlas.glyphMap.get(' ') ?? 0
            rebuildSlice(0, total)
        }
    }
}
