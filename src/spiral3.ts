import * as THREE from 'three'
import { RingBuffer } from './text-stream.js'
import type { CharSlot, TextStreamBuffer } from './text-stream.js'
import { GlyphAtlas } from './glyph-atlas.js'

// ============================================================================
// Configuration Constants
// ============================================================================

const PLANE_SIZE = 5
const PLANE_HALF = PLANE_SIZE / 2

const SPIRAL_TURNS = 5
const SPIRAL_LETTER_COUNT = SPIRAL_TURNS * 51 + 15
const LETTER_SIZE = 2 * (PLANE_SIZE * 18) / 2048

const SPIRAL_ALPHA_EDGE = 1.0
const SPIRAL_ALPHA_CENTER = 1.0
const SPIRAL_FLOW_SPEED = 0.01
const SPIRAL_CENTER_CUTOFF_T = 0.92
const SPIRAL_LETTER_ROTATION = -0.06
const RETURN_DELAY = 0.6
const RETURN_DURATION = 7
const RELEASE_DURATION = 7

// ============================================================================
// Spiral Shader Code (static)
// ============================================================================

const SPIRAL_VERTEX_SHADER = `
    attribute float aReadableT;
    attribute float aShuffledT;
    attribute vec2 aGlyphUv;

    uniform float uPlaneHalf;
    uniform float uSpiralTurns;
    uniform float uLetterSize;
    uniform float uAngleOffset;
    uniform float uSpiralProgress;
    uniform float uCenterCutoffT;
    uniform float uBlend;
    uniform float uAlphaEdge;
    uniform float uAlphaCenter;

    varying vec2 vUv;
    varying vec2 vGlyphUv;
    varying float vEdgeAlpha;
    varying float vVisible;

    const float PI = 3.141592653589793;

    void main() {
        float tOriginal = mod(aReadableT + uSpiralProgress, 1.0);
        float tDisplaced = mod(aShuffledT + uSpiralProgress, 1.0);
        float t = mix(tDisplaced, tOriginal, uBlend);
        if (t > uCenterCutoffT) {
            vVisible = 0.0;
            vEdgeAlpha = 0.0;
            vUv = uv;
            vGlyphUv = aGlyphUv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(0.0, 0.0, 10000.0, 1.0);
            return;
        }

        vVisible = 1.0;
        float radius = uPlaneHalf - t * uPlaneHalf;
        float angle = -uSpiralTurns * 2.0 * PI * t + uAngleOffset;
        vec2 pos = vec2(cos(angle), sin(angle)) * radius;

        vec2 quad = position.xy * uLetterSize;
        float orient = angle + PI + ${SPIRAL_LETTER_ROTATION.toFixed(1)};
        vec2 up = vec2(cos(orient), sin(orient));
        vec2 right = vec2(up.y, -up.x);
        vec2 offset = right * quad.x + up * quad.y;

        vec3 finalPos = vec3(pos + offset, 0.01);

        float edgeT = clamp(length(pos) / uPlaneHalf, 0.0, 1.0);
        vEdgeAlpha = mix(uAlphaCenter, uAlphaEdge, edgeT);

        vUv = uv;
        vGlyphUv = aGlyphUv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
    }
`

const SPIRAL_FRAGMENT_SHADER = `
    uniform sampler2D uAtlas;
    uniform vec2 uAtlasGrid;
    uniform vec3 uLetterColor;

    varying vec2 vUv;
    varying vec2 vGlyphUv;
    varying float vEdgeAlpha;
    varying float vVisible;

    void main() {
        if (vVisible < 0.5) {
            discard;
        }

        float flippedRow = (uAtlasGrid.y - 1.0) - vGlyphUv.y;
        vec2 atlasUv = vec2(
            (vGlyphUv.x + vUv.x) / uAtlasGrid.x,
            (flippedRow + vUv.y) / uAtlasGrid.y
        );

        vec4 glyphSample = texture2D(uAtlas, atlasUv);
        float glyphAlpha = max(glyphSample.a, glyphSample.r);
        float alpha = glyphAlpha * vEdgeAlpha;

        if (alpha < 0.01) {
            discard;
        }

        gl_FragColor = vec4(uLetterColor, alpha);
    }
`

// ============================================================================
// Type Definitions
// ============================================================================

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
    letterCount?: number
}

class SpiralSlotRing extends RingBuffer<CharSlot> {
    textBuffer: TextStreamBuffer = null

    constructor(size: number, textBuffer: TextStreamBuffer) {
        super(size)
        this.textBuffer = textBuffer

        this.syncFromTextBuffer(textBuffer)
    }

    advance(steps: number, slot: CharSlot = null): void {
        for (let step = 0; step < steps; step++) {
            this.shift()
            this.set(this.size - 1, slot ?? this.createBlankSlot())
        }
    }

    syncFromTextBuffer(textBuffer: TextStreamBuffer): void {
        const slots = textBuffer.processed
        const startAt = textBuffer.startAt
        const available = Math.max(0, slots.length - startAt)

        const fill: CharSlot[] = new Array(this.size)

        if (available <= 0) {
            for (let i = 0; i < this.size; i++) {
                fill[i] = this.createBlankSlot()
            }
        } else if (available < this.size) {
            const padding = this.size - available
            for (let i = 0; i < padding; i++) {
                fill[i] = this.createBlankSlot()
            }
            for (let i = 0; i < available; i++) {
                fill[padding + i] = slots[startAt + i]
            }
        } else {
            for (let i = 0; i < this.size; i++) {
                fill[i] = slots[startAt + i]
            }
        }

        this.set(0, ...fill)

        this.textBuffer.advance(Math.min(available, this.size))
    }

    createBlankSlot(): CharSlot {
        return { char: ' ', readableDelta: 0, index: -1 }
    }
}

// ============================================================================
// SpiralController Class (static)
// ============================================================================

export class SpiralController {
    spiralPlane: THREE.Object3D

    private spiralMaterial: THREE.ShaderMaterial
    private spiralGeometry: THREE.InstancedBufferGeometry
    private glyphAtlas: GlyphAtlas
    private fallbackGlyph: number

    private textBuffer: TextStreamBuffer
    private lastTextBufferState: number = 0
    private currentFontFamily: string
    private readonly totalLetterCount: number
    private glyphUvArray: Float32Array
    private readableTArray: Float32Array
    private shuffledTArray: Float32Array
    private glyphAttribute: THREE.InstancedBufferAttribute
    private readableTAttribute: THREE.InstancedBufferAttribute
    private shuffledTAttribute: THREE.InstancedBufferAttribute
    private slotRing: SpiralSlotRing
    private spiralProgress = 0
    private lastProgressIndex = 0
    private blend = 0
    private blendTarget = 0
    private blendProgress = 0
    private returnDelayRemaining = RETURN_DELAY

    constructor(options: SpiralControllerOptions) {
        void options.materialParams
        void options.planeColor

        this.spiralPlane = new THREE.Group()

        this.textBuffer = options.textBuffer
        this.lastTextBufferState = this.textBuffer.state

        this.currentFontFamily = options.fontFamily
        this.glyphAtlas = new GlyphAtlas(this.currentFontFamily)
        this.glyphAtlas.ensureChars(this.textBuffer.uniqueChars)
        this.glyphAtlas.texture.anisotropy = Math.min(
            8,
            options.renderer.capabilities.getMaxAnisotropy()
        )
        this.fallbackGlyph = this.glyphAtlas.glyphMap.get(' ') ?? 0

        this.totalLetterCount = options.letterCount ?? SPIRAL_LETTER_COUNT
        this.glyphUvArray = new Float32Array(this.totalLetterCount * 2)
        this.readableTArray = new Float32Array(this.totalLetterCount)
        this.shuffledTArray = new Float32Array(this.totalLetterCount)
        this.slotRing = new SpiralSlotRing(this.totalLetterCount, this.textBuffer)

        this.spiralGeometry = this.createSpiralGeometry()
        this.spiralMaterial = this.createSpiralMaterial(options)

        const spiralOverlay = new THREE.Mesh(this.spiralGeometry, this.spiralMaterial)
        spiralOverlay.renderOrder = 2
        spiralOverlay.frustumCulled = false
        this.spiralPlane.add(spiralOverlay)

        this.updateAllLetters()
    }


    setSpiralPlaneColor(color: string | number): void {
        void color
    }

    setSpiralLetterColor(color: string | number): void {
        this.spiralMaterial.uniforms.uLetterColor.value.set(color)
    }

    setSpiralFont(fontFamily: string): void {
        this.currentFontFamily = fontFamily
        this.glyphAtlas.setFontFamily(fontFamily)
        this.glyphAtlas.ensureChars(this.textBuffer.uniqueChars)
        this.fallbackGlyph = this.glyphAtlas.glyphMap.get(' ') ?? 0
        this.updateAllLetters()
    }

    updateSpiral(
        delta: number,
        sphereState: { isPointerDown: boolean; scrollSpeed: number }
    ): void {
        // if (this.detectBufferChanges()) {
        //     this.handleBufferChanges()
        // }

        this.updateBlendState(delta, sphereState.isPointerDown)

        this.spiralProgress = (this.spiralProgress + SPIRAL_FLOW_SPEED * delta) % 1
        const progressIndex = Math.floor(this.spiralProgress * this.totalLetterCount)

        if (progressIndex !== this.lastProgressIndex) {
            const steps = (progressIndex - this.lastProgressIndex + this.totalLetterCount) % this.totalLetterCount
            for (let step = 0; step < steps; step++) {
                this.lastProgressIndex = (this.lastProgressIndex + 1) % this.totalLetterCount
                const slotIndex = (this.totalLetterCount - this.lastProgressIndex) % this.totalLetterCount

                const slot = this.textBuffer.shift()
                this.slotRing.advance(1, slot)
                this.updateLetterAt(slotIndex, slot, step)
            }
        }
        this.spiralMaterial.uniforms.uSpiralProgress.value = this.spiralProgress
        this.spiralMaterial.uniforms.uBlend.value = this.blend
    }

    private createSpiralGeometry(): THREE.InstancedBufferGeometry {
        const baseQuad = new THREE.PlaneGeometry(1, 1)
        const geometry = new THREE.InstancedBufferGeometry()
        geometry.index = baseQuad.index
        geometry.attributes.position = baseQuad.attributes.position
        geometry.attributes.uv = baseQuad.attributes.uv
        geometry.instanceCount = this.totalLetterCount

        for (let i = 0; i < this.totalLetterCount; i++) {
            const t = i / this.totalLetterCount
            this.readableTArray[i] = t
            this.shuffledTArray[i] = t
        }
        const readableAttribute = new THREE.InstancedBufferAttribute(this.readableTArray, 1)
        const shuffledAttribute = new THREE.InstancedBufferAttribute(this.shuffledTArray, 1)
        shuffledAttribute.setUsage(THREE.DynamicDrawUsage)
        geometry.setAttribute('aReadableT', readableAttribute)
        geometry.setAttribute('aShuffledT', shuffledAttribute)
        this.readableTAttribute = readableAttribute
        this.shuffledTAttribute = shuffledAttribute

        const glyphAttribute = new THREE.InstancedBufferAttribute(this.glyphUvArray, 2)
        glyphAttribute.setUsage(THREE.DynamicDrawUsage)
        geometry.setAttribute('aGlyphUv', glyphAttribute)
        this.glyphAttribute = glyphAttribute

        return geometry
    }

    private createSpiralMaterial(options: SpiralControllerOptions): THREE.ShaderMaterial {
        return new THREE.ShaderMaterial({
            transparent: true,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            uniforms: {
                uPlaneHalf: { value: PLANE_HALF },
                uSpiralTurns: { value: SPIRAL_TURNS },
                uLetterSize: { value: LETTER_SIZE },
                uAngleOffset: { value: 0 },
                uSpiralProgress: { value: 0 },
                uCenterCutoffT: { value: SPIRAL_CENTER_CUTOFF_T },
                uBlend: { value: 0 },
                uAtlas: { value: this.glyphAtlas.texture },
                uAtlasGrid: { value: new THREE.Vector2(this.glyphAtlas.columns, this.glyphAtlas.rows) },
                uLetterColor: { value: new THREE.Color(options.letterColor) },
                uAlphaEdge: { value: SPIRAL_ALPHA_EDGE },
                uAlphaCenter: { value: SPIRAL_ALPHA_CENTER }
            },
            vertexShader: SPIRAL_VERTEX_SHADER,
            fragmentShader: SPIRAL_FRAGMENT_SHADER
        })
    }

    private detectBufferChanges(): boolean {
        return this.textBuffer.state !== this.lastTextBufferState
    }

    private handleBufferChanges(): void {
        this.lastTextBufferState = this.textBuffer.state
        this.glyphAtlas.ensureChars(this.textBuffer.uniqueChars)
        this.fallbackGlyph = this.glyphAtlas.glyphMap.get(' ') ?? 0
    }

    private updateAllLetters(): void {
        for (let slotIndex = 0; slotIndex < this.totalLetterCount; slotIndex++) {
            const ringIndex = this.totalLetterCount - 1 - slotIndex
            const sourceSlot = this.slotRing.get(ringIndex)
            const character = sourceSlot?.char ?? ' '
            this.writeGlyph(slotIndex, character)
            this.writeReadableT(slotIndex, sourceSlot, 0)
        }

        this.glyphAttribute.needsUpdate = true
        this.shuffledTAttribute.needsUpdate = true
    }

    private updateLetterAt(slotIndex: number, slot: CharSlot, step: number): void {
        const character = slot?.char ?? ' '
        this.writeGlyph(slotIndex, character)
        this.glyphAttribute.needsUpdate = true
        this.writeReadableT(slotIndex, slot, step)
        this.shuffledTAttribute.needsUpdate = true
    }

    private writeGlyph(slotIndex: number, character: string): void {
        const glyphIndex = this.glyphAtlas.glyphMap.get(character) ?? this.fallbackGlyph
        this.glyphUvArray[slotIndex * 2] = glyphIndex % this.glyphAtlas.columns
        this.glyphUvArray[slotIndex * 2 + 1] = Math.floor(glyphIndex / this.glyphAtlas.columns)
    }

    private writeReadableT(slotIndex: number, slot: CharSlot, step: number): void {
        let readableIndex = slotIndex + slot.readableDelta + step

        if (readableIndex < 0 || readableIndex >= this.totalLetterCount) {
            readableIndex = slotIndex + step
        }

        this.readableTArray[slotIndex] = readableIndex / this.totalLetterCount
    }

    private updateBlendState(delta: number, isPointerDown: boolean): void {
        if (isPointerDown) {
            this.returnDelayRemaining = Math.max(0, this.returnDelayRemaining - delta)
            this.blendTarget = this.returnDelayRemaining === 0 ? 1 : 0
        } else {
            this.returnDelayRemaining = RETURN_DELAY
            this.blendTarget = 0
        }

        const duration = this.blendTarget === 1 ? RETURN_DURATION : RELEASE_DURATION
        const step = duration > 0 ? delta / duration : 1

        if (this.blendTarget === 1) {
            this.blendProgress = Math.min(1, this.blendProgress + step)
        } else {
            this.blendProgress = Math.max(0, this.blendProgress - step)
        }

        const t = this.blendProgress
        this.blend = t * t * (3 - 2 * t)
    }
}
