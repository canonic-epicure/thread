import * as THREE from 'three'
import { GlyphAtlas } from './glyph-atlas.js'
import { createSpiralFragmentShader, createSpiralVertexShader } from './spiral3-shaders.js'
import { SpiralSlotRing } from "./spiral-slot-ring.js"
import { type CharSlot, TextStreamBuffer } from "./text-stream-buffer.js"

// ============================================================================
// Configuration Constants
// ============================================================================

const PLANE_SIZE = 5
const PLANE_HALF = PLANE_SIZE / 2

const LETTER_SIZE = 2 * (PLANE_SIZE * 18) / 2048

const SPIRAL_ALPHA_EDGE            = 1.0
const SPIRAL_ALPHA_CENTER          = 1.0
const SPIRAL_FLOW_SPEED            = 0.01
const SPIRAL_VISIBLE_START_T       = 0.5
const SPIRAL_CENTER_CUTOFF_T       = 0.92
const SPIRAL_LETTER_ROTATION       = -0.06
const SPIRAL_READABLE_RADIUS_SCALE = 0.92
const RETURN_DELAY                 = 0.6
const RETURN_DURATION              = 3
const RELEASE_DURATION             = 3

// ============================================================================
// Spiral Shader Code (static)
// ============================================================================

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
    SPIRAL_TURNS: number
    SPIRAL_LETTER_COUNT: number
}

// ============================================================================
// SpiralController Class (static)
// ============================================================================

export class SpiralController {
    SPIRAL_TURNS: number = 5
    SPIRAL_LETTER_COUNT: number = this.SPIRAL_TURNS * 51 + 15

    spiralPlane: THREE.Object3D

    private spiralMaterial: THREE.ShaderMaterial
    private readableMaterial: THREE.ShaderMaterial
    private spiralGeometry: THREE.InstancedBufferGeometry
    private glyphAtlas: GlyphAtlas
    private fallbackGlyph: number

    private textBuffer: TextStreamBuffer
    private lastTextBufferState: number = 0
    private currentFontFamily: string
    private readonly totalLetterCount: number
    private glyphUvArray: Float32Array
    private readableTArray: Float32Array
    private readableDeltaArray: Float32Array
    private glyphAttribute: THREE.InstancedBufferAttribute
    private readableTAttribute: THREE.InstancedBufferAttribute
    private readableDeltaAttribute: THREE.InstancedBufferAttribute
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

        this.SPIRAL_TURNS        = options.SPIRAL_TURNS
        this.SPIRAL_LETTER_COUNT = options.SPIRAL_LETTER_COUNT

        this.textBuffer          = options.textBuffer
        this.lastTextBufferState = this.textBuffer.state

        this.currentFontFamily = options.fontFamily
        this.glyphAtlas        = new GlyphAtlas(this.currentFontFamily)
        this.glyphAtlas.ensureChars(this.textBuffer.uniqueChars)
        this.glyphAtlas.texture.anisotropy = Math.min(
            8,
            options.renderer.capabilities.getMaxAnisotropy()
        )
        this.fallbackGlyph                 = this.glyphAtlas.glyphMap.get(' ') ?? 0

        this.totalLetterCount   = options.letterCount ?? this.SPIRAL_LETTER_COUNT
        this.glyphUvArray       = new Float32Array(this.totalLetterCount * 2)
        this.readableTArray     = new Float32Array(this.totalLetterCount)
        this.readableDeltaArray = new Float32Array(this.totalLetterCount)
        this.slotRing           = new SpiralSlotRing(this.totalLetterCount, this.textBuffer)

        this.spiralGeometry                               = this.createSpiralGeometry()
        this.spiralMaterial                               = this.createSpiralMaterial(options)
        this.readableMaterial                             = this.createSpiralMaterial(options)
        this.readableMaterial.uniforms.uBlend.value       = 1
        this.readableMaterial.uniforms.uRadiusScale.value = 0 // SPIRAL_READABLE_RADIUS_SCALE

        const spiralOverlay         = new THREE.Mesh(this.spiralGeometry, this.spiralMaterial)
        spiralOverlay.renderOrder   = 2
        spiralOverlay.frustumCulled = false
        this.spiralPlane.add(spiralOverlay)

        const readableOverlay         = new THREE.Mesh(this.spiralGeometry, this.readableMaterial)
        readableOverlay.renderOrder   = 3
        readableOverlay.frustumCulled = false
        this.spiralPlane.add(readableOverlay)

        this.updateAllLetters()
    }


    setSpiralPlaneColor(color: string | number): void {
        void color
    }

    setSpiralLetterColor(color: string | number): void {
        this.spiralMaterial.uniforms.uLetterColor.value.set(color)
        this.readableMaterial.uniforms.uLetterColor.value.set(color)
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
                const slotIndex        = (this.totalLetterCount - this.lastProgressIndex) % this.totalLetterCount

                const slot = this.textBuffer.shift()
                this.slotRing.advance(slot)
                this.updateLetterAt(slotIndex, slot)
            }
        }
        this.spiralMaterial.uniforms.uSpiralProgress.value   = this.spiralProgress
        this.spiralMaterial.uniforms.uBlend.value            = this.blend
        this.readableMaterial.uniforms.uSpiralProgress.value = this.spiralProgress
    }

    private createSpiralGeometry(): THREE.InstancedBufferGeometry {
        const baseQuad               = new THREE.PlaneGeometry(1, 1)
        const geometry               = new THREE.InstancedBufferGeometry()
        geometry.index               = baseQuad.index
        geometry.attributes.position = baseQuad.attributes.position
        geometry.attributes.uv       = baseQuad.attributes.uv
        geometry.instanceCount       = this.totalLetterCount

        for (let i = 0; i < this.totalLetterCount; i++) {
            const t                    = i / this.totalLetterCount
            this.readableTArray[i]     = t
            this.readableDeltaArray[i] = 0
        }
        const readableAttribute      = new THREE.InstancedBufferAttribute(this.readableTArray, 1)
        const readableDeltaAttribute = new THREE.InstancedBufferAttribute(this.readableDeltaArray, 1)
        readableDeltaAttribute.setUsage(THREE.DynamicDrawUsage)
        geometry.setAttribute('aReadableT', readableAttribute)
        geometry.setAttribute('aReadableDelta', readableDeltaAttribute)
        this.readableTAttribute     = readableAttribute
        this.readableDeltaAttribute = readableDeltaAttribute

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
                uSpiralTurns: { value: this.SPIRAL_TURNS },
                uLetterSize: { value: LETTER_SIZE },
                uAngleOffset: { value: 0 },
                uSpiralProgress: { value: 0 },
                uCenterCutoffT: { value: SPIRAL_CENTER_CUTOFF_T },
                uVisibleStartT: { value: SPIRAL_VISIBLE_START_T },
                uBlend: { value: 0 },
                uRadiusScale: { value: 1 },
                uLetterCount: { value: this.totalLetterCount },
                uAtlas: { value: this.glyphAtlas.texture },
                uAtlasGrid: { value: new THREE.Vector2(this.glyphAtlas.columns, this.glyphAtlas.rows) },
                uLetterColor: { value: new THREE.Color(options.letterColor) },
                uAlphaEdge: { value: SPIRAL_ALPHA_EDGE },
                uAlphaCenter: { value: SPIRAL_ALPHA_CENTER }
            },
            vertexShader: createSpiralVertexShader({ letterRotation: SPIRAL_LETTER_ROTATION }),
            fragmentShader: createSpiralFragmentShader()
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
            const ringIndex  = this.totalLetterCount - 1 - slotIndex
            const sourceSlot = this.slotRing.get(ringIndex)
            const character  = sourceSlot?.char ?? ' '
            this.writeGlyph(slotIndex, character)
            this.writeReadableT(slotIndex, sourceSlot)
            this.writeReadableDelta(slotIndex, sourceSlot)
        }

        this.glyphAttribute.needsUpdate         = true
        this.readableTAttribute.needsUpdate     = true
        this.readableDeltaAttribute.needsUpdate = true
    }

    private updateLetterAt(slotIndex: number, slot: CharSlot): void {
        const character = slot?.char ?? ' '
        this.writeGlyph(slotIndex, character)
        this.glyphAttribute.needsUpdate         = true
        this.readableTArray[slotIndex]          = slotIndex / this.totalLetterCount
        this.readableDeltaArray[slotIndex]      = slot.readableDelta
        this.readableTAttribute.needsUpdate     = true
        this.readableDeltaAttribute.needsUpdate = true
    }

    private writeGlyph(slotIndex: number, character: string): void {
        const glyphIndex                     = this.glyphAtlas.glyphMap.get(character) ?? this.fallbackGlyph
        this.glyphUvArray[slotIndex * 2]     = glyphIndex % this.glyphAtlas.columns
        this.glyphUvArray[slotIndex * 2 + 1] = Math.floor(glyphIndex / this.glyphAtlas.columns)
    }

    private writeReadableT(slotIndex: number, slot: CharSlot): void {
        void slot
        this.readableTArray[slotIndex] = slotIndex / this.totalLetterCount
    }

    private writeReadableDelta(slotIndex: number, slot: CharSlot): void {
        this.readableDeltaArray[slotIndex] = slot.readableDelta
    }

    getDisplacedTValues(): number[] {
        const result = new Array(this.totalLetterCount)
        for (let i = 0; i < this.totalLetterCount; i++) {
            const t   = (this.readableTArray[i] * this.totalLetterCount + this.readableDeltaArray[i])
                / this.totalLetterCount + this.spiralProgress
            result[i] = this.wrap01(t)
        }
        return result
    }

    getReadableTValues(): number[] {
        const result = new Array(this.totalLetterCount)
        for (let i = 0; i < this.totalLetterCount; i++) {
            const t   = this.readableTArray[i] + this.spiralProgress
            result[i] = this.wrap01(t)
        }
        return result
    }

    private wrap01(value: number): number {
        return ((value % 1) + 1) % 1
    }

    private updateBlendState(delta: number, isPointerDown: boolean): void {
        if (isPointerDown) {
            this.returnDelayRemaining = Math.max(0, this.returnDelayRemaining - delta)
            this.blendTarget          = this.returnDelayRemaining === 0 ? 1 : 0
        } else {
            this.returnDelayRemaining = RETURN_DELAY
            this.blendTarget          = 0
        }

        const duration = this.blendTarget === 1 ? RETURN_DURATION : RELEASE_DURATION
        const step     = duration > 0 ? delta / duration : 1

        if (this.blendTarget === 1) {
            this.blendProgress = Math.min(1, this.blendProgress + step)
        } else {
            this.blendProgress = Math.max(0, this.blendProgress - step)
        }

        const t    = this.blendProgress
        this.blend = t * t * (3 - 2 * t)
    }
}
