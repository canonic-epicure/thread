import * as THREE from 'three'
import { RingBuffer } from './text-stream.js'
import type { CharSlot, TextStreamBuffer } from './text-stream.js'
import { GlyphAtlas } from './glyph-atlas.js'

// ============================================================================
// Configuration Constants
// ============================================================================

const PLANE_SIZE = 5
const PLANE_HALF = PLANE_SIZE / 2

const SPIRAL_TURNS = 10
const SPIRAL_LETTER_COUNT = SPIRAL_TURNS * 91 + 15
const LETTER_SIZE = (PLANE_SIZE * 18) / 2048

const SPIRAL_ALPHA_EDGE = 1.0
const SPIRAL_ALPHA_CENTER = 1.0

// ============================================================================
// Spiral Shader Code (static)
// ============================================================================

const SPIRAL_VERTEX_SHADER = `
    attribute float aT;
    attribute vec2 aGlyphUv;

    uniform float uPlaneHalf;
    uniform float uSpiralTurns;
    uniform float uLetterSize;
    uniform float uAngleOffset;
    uniform float uAlphaEdge;
    uniform float uAlphaCenter;

    varying vec2 vUv;
    varying vec2 vGlyphUv;
    varying float vEdgeAlpha;

    const float PI = 3.141592653589793;

    void main() {
        float radius = uPlaneHalf - aT * uPlaneHalf;
        float angle = -uSpiralTurns * 2.0 * PI * aT + uAngleOffset;
        vec2 pos = vec2(cos(angle), sin(angle)) * radius;

        vec2 quad = position.xy * uLetterSize;
        vec3 normal = vec3(0.0, 0.0, 1.0);
        vec3 inward = vec3(-pos, 0.0);
        vec3 inwardTangent = length(inward) > 0.0001 ? normalize(inward) : vec3(0.0, 1.0, 0.0);
        vec3 rightTangent = normalize(cross(inwardTangent, normal));
        vec3 offset = rightTangent * quad.x + inwardTangent * quad.y;

        vec3 finalPos = vec3(pos, 0.01) + offset;

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

    void main() {
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
}

class SpiralSlotRing extends RingBuffer<CharSlot> {
    textBuffer: TextStreamBuffer = null

    constructor(size: number, textBuffer: TextStreamBuffer) {
        super(size)
        this.textBuffer = textBuffer

        this.syncFromTextBuffer(textBuffer)
    }

    syncFromTextBuffer(textBuffer: TextStreamBuffer): void {
        const slots = textBuffer.processed as CharSlot[]
        const startAt = textBuffer.startAt
        const available = Math.max(0, slots.length - startAt)

        const fill: CharSlot[] = new Array(this.size)

        if (available <= 0) {
            for (let i = 0; i < this.size; i++) {
                fill[i] = { char: ' ', originalDelta: 0 }
            }
        } else if (available < this.size) {
            const padding = this.size - available
            for (let i = 0; i < padding; i++) {
                fill[i] = { char: ' ', originalDelta: 0 }
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
    private glyphAttribute: THREE.InstancedBufferAttribute
    private slotRing: SpiralSlotRing

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

        this.totalLetterCount = SPIRAL_LETTER_COUNT
        this.glyphUvArray = new Float32Array(this.totalLetterCount * 2)
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
        this.spiralMaterial.uniforms.uPlaneColor.value.set(color)
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
        void delta
        void sphereState
        if (this.detectBufferChanges()) {
            this.handleBufferChanges()
        }
    }

    private createSpiralGeometry(): THREE.InstancedBufferGeometry {
        const baseQuad = new THREE.PlaneGeometry(1, 1)
        const geometry = new THREE.InstancedBufferGeometry()
        geometry.index = baseQuad.index
        geometry.attributes.position = baseQuad.attributes.position
        geometry.attributes.uv = baseQuad.attributes.uv
        geometry.instanceCount = this.totalLetterCount

        const tArray = new Float32Array(this.totalLetterCount)
        for (let i = 0; i < this.totalLetterCount; i++) {
            tArray[i] = i / this.totalLetterCount
        }
        geometry.setAttribute('aT', new THREE.InstancedBufferAttribute(tArray, 1))

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
        if (this.textBuffer.state !== this.lastTextBufferState) {
            this.lastTextBufferState = this.textBuffer.state
            this.glyphAtlas.ensureChars(this.textBuffer.uniqueChars)
            this.fallbackGlyph = this.glyphAtlas.glyphMap.get(' ') ?? 0
        }

        this.slotRing.syncFromTextBuffer(this.textBuffer)
        this.updateAllLetters()
    }

    private updateAllLetters(): void {
        for (let slotIndex = 0; slotIndex < this.totalLetterCount; slotIndex++) {
            const ringIndex = this.totalLetterCount - 1 - slotIndex
            const sourceSlot = this.slotRing.get(ringIndex)
            const character = sourceSlot?.char ?? ' '

            const glyphIndex = this.glyphAtlas.glyphMap.get(character) ?? this.fallbackGlyph
            this.glyphUvArray[slotIndex * 2] = glyphIndex % this.glyphAtlas.columns
            this.glyphUvArray[slotIndex * 2 + 1] = Math.floor(glyphIndex / this.glyphAtlas.columns)
        }

        this.glyphAttribute.needsUpdate = true
    }
}
