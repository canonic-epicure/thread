import * as THREE from 'three'
import { type CharSlot, TextStreamBuffer } from "./text-stream-buffer.js"
import { GlyphAtlas } from './glyph-atlas.js'
import { createPlaneParticles } from './plane-particles.js'
import {
    createPlaneLenses,
    PLANE_LENS_COUNT
} from './plane-lens.js'

// ============================================================================
// Configuration Constants
// ============================================================================

// Plane geometry
const PLANE_SIZE = 5
const PLANE_SEGMENTS = 350
const PLANE_HALF = PLANE_SIZE / 2

// Depression (sink) parameters - creates the central dip in the plane
const DEPRESSION_RADIUS = 3.1   // Distance from center where depression ends
const DEPRESSION_DEPTH = 15.4   // How deep the depression goes
const DEPRESSION_FALLOFF = 18   // How smoothly the depression fades (Gaussian)

// Plane visual fade (edge transparency)
const PLANE_FADE_RESOLUTION = 512
const PLANE_FADE_INNER = 0.12   // Inner radius where fade starts
const PLANE_FADE_OUTER = 0.85   // Outer radius where fade ends

// Spiral parameters
const SPIRAL_TURNS = 10                    // Number of full rotations
const SPIRAL_FLOW_SPEED = 0.008           // How fast letters move along spiral (per second)
const SPIRAL_LETTER_COUNT = SPIRAL_TURNS * 91 + 15  // Total number of letter instances

// Spiral visual appearance
const SPIRAL_ALPHA_EDGE = 0      // Transparency at outer edge
const SPIRAL_ALPHA_CENTER = 1.0 // Opacity at center
const LETTER_SIZE = (PLANE_SIZE * 18) / 2048

// Interaction state transitions
const RETURN_DELAY = 0.6         // Delay before transitioning to ordered state when pointer held
const RETURN_DURATION = 7        // Time to transition to ordered state
const RELEASE_DURATION = 7       // Time to transition back to displaced state

// ============================================================================
// Plane Geometry Functions
// ============================================================================

/**
 * Calculates the height of the plane at a given (x, y) position.
 * Creates a Gaussian-style depression centered at the origin.
 */
function calculatePlaneHeight(x: number, y: number): number {
    const distanceFromCenter = Math.hypot(x, y)

    // Outside the depression radius, plane is flat
    if (distanceFromCenter > DEPRESSION_RADIUS) {
        return 0
    }

    // Inside: apply Gaussian falloff for smooth depression
    const normalizedDistance = distanceFromCenter / DEPRESSION_RADIUS
    const gaussianFactor = Math.exp(-DEPRESSION_FALLOFF * normalizedDistance * normalizedDistance)

    return -DEPRESSION_DEPTH * gaussianFactor
}

/**
 * Creates the base depressed plane mesh with alpha fade at edges.
 */
function createDepressedPlane(
    materialParams: SpiralControllerOptions['materialParams'],
    planeColor: number
): THREE.Mesh {
    // Create highly segmented plane for smooth depression
    const geometry = new THREE.PlaneGeometry(PLANE_SIZE, PLANE_SIZE, PLANE_SEGMENTS, PLANE_SEGMENTS)
    const positions = geometry.attributes.position

    // Deform vertices to create depression
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i)
        const y = positions.getY(i)
        const z = calculatePlaneHeight(x, y)
        positions.setZ(i, z)
    }

    // Recalculate normals for proper lighting
    geometry.computeVertexNormals()

    // Create alpha map for edge fade
    const alphaMap = createPlaneAlphaMap()

    const material = new THREE.MeshStandardMaterial({
        ...materialParams,
        color: planeColor,
        transparent: true,
        depthWrite: true,
        alphaMap,
        alphaTest: 0,
        side: THREE.FrontSide  // Only render front face
    })

    const plane = new THREE.Mesh(geometry, material)
    plane.position.set(0, 0, 0)
    plane.rotation.x = -1.3  // Tilt plane for better viewing angle

    return plane
}

/**
 * Creates a radial gradient texture for plane edge fade.
 */
function createPlaneAlphaMap(): THREE.CanvasTexture {
    const size = PLANE_FADE_RESOLUTION
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')

    if (!ctx) {
        throw new Error('Failed to get canvas context for plane alpha map')
    }

    const center = size / 2
    const maxRadius = center

    // Create radial gradient: opaque in center, transparent at edges
    const gradient = ctx.createRadialGradient(
        center, center,
        maxRadius * PLANE_FADE_INNER,  // Start fade here
        center, center,
        maxRadius * PLANE_FADE_OUTER   // Fully transparent here
    )

    gradient.addColorStop(0, 'rgba(255,255,255,1)')  // Opaque center
    gradient.addColorStop(1, 'rgba(255,255,255,0)') // Transparent edge

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    texture.needsUpdate = true

    return texture
}

// ============================================================================
// Spiral Shader Code
// ============================================================================

/**
 * Vertex shader for spiral letters.
 * Computes position along spiral path, applies depression, and orients letters toward center.
 */
const SPIRAL_VERTEX_SHADER = `
    attribute float aOriginalT;      // Original position in text stream (0-1)
    attribute float aDisplacedT;      // Displaced/shuffled position (0-1)
    attribute vec2 aGlyphUv;         // Glyph coordinates in atlas

    uniform float uSpiralProgress;   // Current animation progress (0-1, wraps)
    uniform float uBlend;             // Blend factor: 0=displaced, 1=ordered
    uniform float uPlaneHalf;         // Half size of plane
    uniform float uRadialStep;        // Radial step per turn
    uniform float uSpiralTurns;       // Number of spiral turns
    uniform float uLetterSize;        // Size of each letter quad
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

    // Calculate plane height at given 2D position (matches CPU function)
    float planeHeight(vec2 pos) {
        float r = length(pos);
        if (r > uDepressionRadius) {
            return 0.0;
        }
        float rNorm = r / uDepressionRadius;
        return -uDepressionDepth * exp(-uDepressionFalloff * rNorm * rNorm);
    }

    // Calculate surface normal at given 2D position
    vec3 planeNormal(vec2 pos) {
        float r = length(pos);
        if (r < 0.0001 || r > uDepressionRadius) {
            return vec3(0.0, 0.0, 1.0);  // Flat surface
        }
        float rNorm = r / uDepressionRadius;
        float expTerm = exp(-uDepressionFalloff * rNorm * rNorm);
        float dhdr = uDepressionDepth * expTerm * (2.0 * uDepressionFalloff * r) /
            (uDepressionRadius * uDepressionRadius);
        vec2 grad = (pos / r) * dhdr;
        return normalize(vec3(-grad.x, -grad.y, 1.0));
    }

    void main() {
        // Debug mode: render letters at origin
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

        // Step 1: Calculate spiral positions for both states
        // Add progress and wrap to [0, 1)
        float tOriginal = mod(aOriginalT + uSpiralProgress, 1.0);
        float tDisplaced = mod(aDisplacedT + uSpiralProgress, 1.0);

        // Convert normalized position (0-1) to spiral coordinates
        // Radius decreases from edge to center
        float radiusOriginal = uPlaneHalf - tOriginal * uRadialStep;
        float angleOriginal = -uSpiralTurns * 2.0 * PI * tOriginal;
        vec2 originalPos = vec2(cos(angleOriginal), sin(angleOriginal)) * radiusOriginal;

        float radiusDisplaced = uPlaneHalf - tDisplaced * uRadialStep;
        float angleDisplaced = -uSpiralTurns * 2.0 * PI * tDisplaced;
        vec2 displacedPos = vec2(cos(angleDisplaced), sin(angleDisplaced)) * radiusDisplaced;

        // Step 2: Blend between displaced and ordered positions
        vec2 pos = mix(displacedPos, originalPos, uBlend);

        // Step 3: Apply lens distortions (invisible magnifying effects)
        for (int i = 0; i < ${PLANE_LENS_COUNT}; i++) {
            if (i >= uLensCount) break;

            vec2 delta = pos - uLensPos[i];
            float dist = length(delta);
            float radius = uLensRadius[i];

            if (dist < radius) {
                // Apply radial push/pull distortion
                float t = 1.0 - (dist / radius);
                float falloff = t * t * (3.0 - 2.0 * t);  // Smoothstep
                vec2 dir = dist > 0.0001 ? normalize(delta) : vec2(1.0, 0.0);
                pos += dir * uLensStrength[i] * falloff;
            }
        }

        // Step 4: Orient letter quad to face center and follow surface
        vec2 quad = position.xy * uLetterSize;
        vec3 normal = planeNormal(pos);

        // Calculate tangent vectors for proper letter orientation
        vec3 inward = vec3(-pos, 0.0);  // Direction toward center
        vec3 inwardTangent = inward - normal * dot(inward, normal);
        if (length(inwardTangent) < 0.0001) {
            inwardTangent = vec3(0.0, 1.0, 0.0);
        } else {
            inwardTangent = normalize(inwardTangent);
        }
        vec3 rightTangent = normalize(cross(inwardTangent, normal));

        // Offset quad along surface
        vec3 offset = rightTangent * quad.x + inwardTangent * quad.y;

        // Step 5: Final position with depression height
        float z = planeHeight(pos) + 0.01;  // Slight offset above surface
        vec3 finalPos = vec3(pos, z) + offset;

        // Step 6: Calculate edge alpha fade
        float edgeT = clamp(length(pos) / uPlaneHalf, 0.0, 1.0);
        vEdgeAlpha = mix(uAlphaCenter, uAlphaEdge, edgeT);

        vUv = uv;
        vGlyphUv = aGlyphUv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(finalPos, 1.0);
    }
`

/**
 * Fragment shader for spiral letters.
 * Samples glyph from atlas and applies edge alpha fade.
 */
const SPIRAL_FRAGMENT_SHADER = `
    uniform sampler2D uAtlas;
    uniform vec2 uAtlasGrid;
    uniform vec3 uLetterColor;
    uniform float uDebugSolid;

    varying vec2 vUv;
    varying vec2 vGlyphUv;
    varying float vEdgeAlpha;

    void main() {
        // Debug mode: solid color
        if (uDebugSolid > 0.5) {
            gl_FragColor = vec4(uLetterColor, 1.0);
            return;
        }

        // Calculate UV coordinates in glyph atlas
        // Flip Y because canvas coordinates are top-to-bottom
        float flippedRow = (uAtlasGrid.y - 1.0) - vGlyphUv.y;
        vec2 atlasUv = vec2(
            (vGlyphUv.x + vUv.x) / uAtlasGrid.x,
            (flippedRow + vUv.y) / uAtlasGrid.y
        );

        // Sample glyph texture
        vec4 glyphSample = texture2D(uAtlas, atlasUv);
        // Use alpha channel, or red channel if alpha is missing
        float glyphAlpha = max(glyphSample.a, glyphSample.r);

        // Combine glyph alpha with edge fade
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

// ============================================================================
// SpiralController Class
// ============================================================================

/**
 * Controls the spiral plane visualization.
 *
 * Mental Model:
 * - A large plane with a central depression (sink)
 * - Letters flow along a spiral path from edge to center
 * - Each letter has two states:
 *   - Displaced: shuffled/randomized position (default)
 *   - Ordered: true position in text stream (when pointer held)
 * - Smooth transitions between states based on interaction
 * - Letters continuously flow as new text arrives
 */
export class SpiralController {
    // Public: the main plane mesh to add to scene
    spiralPlane: THREE.Mesh

    // Plane components
    private planeMaterial: THREE.MeshStandardMaterial
    private particleSystem: ReturnType<typeof createPlaneParticles>
    private lensSystem: ReturnType<typeof createPlaneLenses>

    // Spiral letter rendering
    private spiralMaterial: THREE.ShaderMaterial
    private spiralGeometry: THREE.InstancedBufferGeometry
    private glyphAtlas: GlyphAtlas
    private fallbackGlyph: number

    // Text buffer tracking
    private textBuffer: TextStreamBuffer
    private currentFontFamily: string

    // Letter instance data
    private readonly totalLetterCount: number
    private originalTArray: Float32Array      // Original positions (never changes)
    private displacedTArray: Float32Array    // Displaced positions (updates when text changes)
    private glyphUvArray: Float32Array        // Glyph atlas coordinates
    private glyphAttribute: THREE.InstancedBufferAttribute

    // Animation state
    private spiralProgress: number = 0        // Current flow progress (0-1, wraps)
    private lastProgressIndex: number = 0     // Last letter index that was updated

    // Interaction state (blending between displaced and ordered)
    private blend: number = 0                 // Current blend value (0=displaced, 1=ordered)
    private blendTarget: number = 0           // Target blend value
    private blendProgress: number = 0          // Progress toward target (0-1)
    private returnDelayRemaining: number = RETURN_DELAY

    // Buffer change tracking
    private lastVisibleCount: number
    private lastVisibleStartAt: number
    private lastUniqueCount: number
    private needsInitialFill: boolean = true

    constructor(options: SpiralControllerOptions) {
        // Initialize plane
        this.spiralPlane = createDepressedPlane(options.materialParams, options.planeColor)
        this.planeMaterial = this.spiralPlane.material as THREE.MeshStandardMaterial

        // Initialize particle system (visual streaks on plane)
        this.particleSystem = createPlaneParticles(PLANE_HALF, calculatePlaneHeight)
        this.particleSystem.object.renderOrder = 1
        this.spiralPlane.add(this.particleSystem.object)

        // Initialize text buffer tracking
        this.textBuffer = options.textBuffer
        this.lastVisibleCount = this.textBuffer.processed.length
        this.lastVisibleStartAt = this.textBuffer.startAt
        this.lastUniqueCount = this.textBuffer.uniqueChars.size

        // Initialize glyph atlas
        this.currentFontFamily = options.fontFamily
        this.glyphAtlas = new GlyphAtlas(this.currentFontFamily)
        this.glyphAtlas.ensureChars(this.textBuffer.uniqueChars)
        this.glyphAtlas.texture.anisotropy = Math.min(
            8,
            options.renderer.capabilities.getMaxAnisotropy()
        )
        this.fallbackGlyph = this.glyphAtlas.glyphMap.get(' ') ?? 0

        // Initialize letter instance arrays
        this.totalLetterCount = SPIRAL_LETTER_COUNT
        this.originalTArray = new Float32Array(this.totalLetterCount)
        this.displacedTArray = new Float32Array(this.totalLetterCount)
        this.glyphUvArray = new Float32Array(this.totalLetterCount * 2)

        // Initialize arrays with default values
        for (let i = 0; i < this.totalLetterCount; i++) {
            const normalizedPosition = i / this.totalLetterCount
            this.originalTArray[i] = normalizedPosition
            this.displacedTArray[i] = normalizedPosition

            // Default to space character
            const glyphIndex = this.fallbackGlyph
            this.glyphUvArray[i * 2] = glyphIndex % this.glyphAtlas.columns
            this.glyphUvArray[i * 2 + 1] = Math.floor(glyphIndex / this.glyphAtlas.columns)
        }

        // Create instanced geometry for spiral letters
        this.spiralGeometry = this.createSpiralGeometry()

        // Create shader material for spiral letters
        this.spiralMaterial = this.createSpiralMaterial(options)

        // Create spiral overlay mesh
        const spiralOverlay = new THREE.Mesh(this.spiralGeometry, this.spiralMaterial)
        spiralOverlay.renderOrder = 2
        spiralOverlay.frustumCulled = false
        this.spiralPlane.add(spiralOverlay)

        // Initialize lens distortion system
        this.lensSystem = this.createLensSystem()
    }

    /**
     * Creates the instanced geometry for spiral letters.
     */
    private createSpiralGeometry(): THREE.InstancedBufferGeometry {
        // Base quad geometry (reused for all instances)
        const baseQuad = new THREE.PlaneGeometry(1, 1)

        const geometry = new THREE.InstancedBufferGeometry()
        geometry.index = baseQuad.index
        geometry.attributes.position = baseQuad.attributes.position
        geometry.attributes.uv = baseQuad.attributes.uv
        geometry.instanceCount = this.totalLetterCount

        // Original positions (static - never changes)
        geometry.setAttribute(
            'aOriginalT',
            new THREE.InstancedBufferAttribute(this.originalTArray, 1)
        )

        // Displaced positions (dynamic - updates when text changes)
        const displacedAttribute = new THREE.InstancedBufferAttribute(
            this.displacedTArray,
            1
        )
        displacedAttribute.setUsage(THREE.DynamicDrawUsage)
        geometry.setAttribute('aDisplacedT', displacedAttribute)

        // Glyph atlas coordinates (dynamic - updates when text changes)
        const glyphAttribute = new THREE.InstancedBufferAttribute(
            this.glyphUvArray,
            2
        )
        glyphAttribute.setUsage(THREE.DynamicDrawUsage)
        geometry.setAttribute('aGlyphUv', glyphAttribute)
        this.glyphAttribute = glyphAttribute

        return geometry
    }

    /**
     * Creates the shader material for spiral letters.
     */
    private createSpiralMaterial(options: SpiralControllerOptions): THREE.ShaderMaterial {
        return new THREE.ShaderMaterial({
            transparent: true,
            depthTest: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            uniforms: {
                uSpiralProgress: { value: 0 },
                uBlend: { value: 0 },
                uPlaneHalf: { value: PLANE_HALF },
                uRadialStep: { value: PLANE_HALF },
                uSpiralTurns: { value: SPIRAL_TURNS },
                uLetterSize: { value: LETTER_SIZE },
                uDepressionRadius: { value: DEPRESSION_RADIUS },
                uDepressionDepth: { value: DEPRESSION_DEPTH },
                uDepressionFalloff: { value: DEPRESSION_FALLOFF },
                uAtlas: { value: this.glyphAtlas.texture },
                uAtlasGrid: { value: new THREE.Vector2(this.glyphAtlas.columns, this.glyphAtlas.rows) },
                uLetterColor: { value: new THREE.Color(options.letterColor) },
                uAlphaEdge: { value: SPIRAL_ALPHA_EDGE },
                uAlphaCenter: { value: SPIRAL_ALPHA_CENTER },
                uDebugSolid: { value: 0 },
                uLensCount: { value: PLANE_LENS_COUNT },
                uLensPos: { value: Array.from({ length: PLANE_LENS_COUNT }, () => new THREE.Vector2()) },
                uLensRadius: { value: new Array(PLANE_LENS_COUNT).fill(0) },
                uLensStrength: { value: new Array(PLANE_LENS_COUNT).fill(0) }
            },
            vertexShader: SPIRAL_VERTEX_SHADER,
            fragmentShader: SPIRAL_FRAGMENT_SHADER
        })
    }

    /**
     * Creates the lens distortion system.
     */
    private createLensSystem(): ReturnType<typeof createPlaneLenses> {
        const lensPosUniform = this.spiralMaterial.uniforms.uLensPos.value as THREE.Vector2[]
        const lensRadiusUniform = this.spiralMaterial.uniforms.uLensRadius.value as number[]
        const lensStrengthUniform = this.spiralMaterial.uniforms.uLensStrength.value as number[]

        return createPlaneLenses(PLANE_HALF, {
            pos: lensPosUniform,
            radius: lensRadiusUniform,
            strength: lensStrengthUniform
        })
    }

    // ========================================================================
    // Public API
    // ========================================================================

    /**
     * Sets the plane base color.
     */
    setSpiralPlaneColor(color: string | number): void {
        this.planeMaterial.color.set(color)
    }

    /**
     * Sets the letter color.
     */
    setSpiralLetterColor(color: string | number): void {
        this.spiralMaterial.uniforms.uLetterColor.value.set(color)
    }

    /**
     * Changes the font family and rebuilds the glyph atlas.
     */
    setSpiralFont(fontFamily: string): void {
        this.currentFontFamily = fontFamily
        this.glyphAtlas.setFontFamily(fontFamily)
        this.glyphAtlas.ensureChars(Array.from(this.textBuffer.uniqueChars))
        this.fallbackGlyph = this.glyphAtlas.glyphMap.get(' ') ?? 0

        // Rebuild all letters with new font
        this.updateLetterSlice(0, this.totalLetterCount)
    }

    /**
     * Main update function called every frame.
     * Updates animation, handles text changes, and manages state transitions.
     */
    updateSpiral(
        delta: number,
        sphereState: { isPointerDown: boolean; scrollSpeed: number }
    ): void {
        // Update particle system
        this.particleSystem.update(delta)

        // Check for text buffer changes
        const bufferChanged = this.detectBufferChanges()
        if (bufferChanged) {
            this.handleBufferChanges()
        }

        // Update lens distortion system
        this.lensSystem.update(delta)

        // Update interaction state (blending between displaced/ordered)
        this.updateInteractionState(delta, sphereState.isPointerDown)

        // Update spiral flow animation
        this.updateSpiralFlow(delta)

        // Update shader uniforms
        this.spiralMaterial.uniforms.uSpiralProgress.value = this.spiralProgress
        this.spiralMaterial.uniforms.uBlend.value = this.blend
    }

    // ========================================================================
    // Internal Update Methods
    // ========================================================================

    /**
     * Detects if the text buffer has changed.
     */
    private detectBufferChanges(): boolean {
        return (
            this.textBuffer.uniqueChars.size !== this.lastUniqueCount ||
            this.textBuffer.processed.length !== this.lastVisibleCount ||
            this.textBuffer.startAt !== this.lastVisibleStartAt
        )
    }

    /**
     * Handles text buffer changes (new characters, shifted content).
     */
    private handleBufferChanges(): void {
        // Update unique characters in atlas
        if (this.textBuffer.uniqueChars.size !== this.lastUniqueCount) {
            this.lastUniqueCount = this.textBuffer.uniqueChars.size
            this.glyphAtlas.ensureChars(this.textBuffer.uniqueChars)
            this.fallbackGlyph = this.glyphAtlas.glyphMap.get(' ') ?? 0
        }

        // Update tracking variables
        this.lastVisibleCount = this.textBuffer.processed.length
        this.lastVisibleStartAt = this.textBuffer.startAt

        // Rebuild affected letters
        const affectedCount = Math.max(this.lastVisibleCount, this.lastVisibleStartAt + 1)
        this.updateLetterSlice(0, Math.min(this.totalLetterCount, affectedCount))
    }

    /**
     * Updates interaction state: transitions between displaced and ordered positions.
     */
    private updateInteractionState(delta: number, isPointerDown: boolean): void {
        if (isPointerDown) {
            // Pointer held: count down delay, then transition to ordered
            this.returnDelayRemaining = Math.max(0, this.returnDelayRemaining - delta)
            this.blendTarget = this.returnDelayRemaining === 0 ? 1 : 0
        } else {
            // Pointer released: reset delay, transition back to displaced
            this.returnDelayRemaining = RETURN_DELAY
            this.blendTarget = 0
        }

        // Smoothly interpolate toward target blend value
        const duration = this.blendTarget === 1 ? RETURN_DURATION : RELEASE_DURATION
        const step = duration > 0 ? delta / duration : 1

        if (this.blendTarget === 1) {
            this.blendProgress = Math.min(1, this.blendProgress + step)
        } else {
            this.blendProgress = Math.max(0, this.blendProgress - step)
        }

        // Apply smoothstep easing for smooth transitions
        const t = this.blendProgress
        this.blend = t * t * (3 - 2 * t)
    }

    /**
     * Updates spiral flow animation and handles letter wrapping.
     */
    private updateSpiralFlow(delta: number): void {
        // Advance spiral progress (wraps at 1.0)
        this.spiralProgress = (this.spiralProgress + SPIRAL_FLOW_SPEED * delta) % 1

        // Determine which letter index we're at
        const currentProgressIndex = Math.floor(this.spiralProgress * SPIRAL_LETTER_COUNT)

        // If we've moved to a new letter, update that letter
        if (currentProgressIndex !== this.lastProgressIndex) {
            const steps = (currentProgressIndex - this.lastProgressIndex + SPIRAL_LETTER_COUNT) % SPIRAL_LETTER_COUNT

            for (let step = 0; step < steps; step++) {
                this.lastProgressIndex = (this.lastProgressIndex + 1) % SPIRAL_LETTER_COUNT

                // Calculate which slot wraps from center to edge
                const slotIndex = (SPIRAL_LETTER_COUNT - this.lastProgressIndex) % SPIRAL_LETTER_COUNT

                // Shift buffer and update this letter
                this.textBuffer.shift()
                this.updateLetterSlice(slotIndex, 1)
            }

            // Update tracking after shift
            this.lastVisibleCount = this.textBuffer.processed.length
            this.lastVisibleStartAt = this.textBuffer.startAt
        }

        // Initial fill on first frame
        if (this.needsInitialFill) {
            this.updateLetterSlice(0, this.totalLetterCount)
            this.needsInitialFill = false
        }
    }

    /**
     * Updates a slice of letters with current text buffer content.
     *
     * @param startIndex - Starting index in letter array
     * @param count - Number of letters to update
     */
    private updateLetterSlice(startIndex: number, count: number): void {
        const slots = this.textBuffer.processed as CharSlot[]
        const startAt = this.textBuffer.startAt
        const available = slots.length - startAt
        const padding = Math.max(0, this.totalLetterCount - available)

        for (let i = 0; i < count; i++) {
            const slotIndex = (startIndex + i) % this.totalLetterCount
            let character = ' '
            let displacedIndex = slotIndex
            const bufferIndex = slotIndex - padding

            // Get character from buffer if available
            if (bufferIndex >= 0 && available > 0) {
                const sourceSlot = slots[startAt + (bufferIndex % available)]
                if (sourceSlot) {
                    character = sourceSlot.char

                    // Calculate displaced index based on original delta
                    const fullIndex = startAt + bufferIndex - sourceSlot.readableDelta
                    let shuffledIndex = fullIndex - startAt

                    // Wrap shuffled index to valid range
                    if (shuffledIndex < 0) {
                        shuffledIndex = (shuffledIndex % available + available) % available
                    } else if (shuffledIndex >= available) {
                        shuffledIndex = shuffledIndex % available
                    }

                    displacedIndex = padding + shuffledIndex
                }
            }

            // Update displaced position
            this.displacedTArray[slotIndex] = displacedIndex / this.totalLetterCount

            // Update glyph atlas coordinates
            const glyphIndex = this.glyphAtlas.glyphMap.get(character) ?? this.fallbackGlyph
            this.glyphUvArray[slotIndex * 2] = glyphIndex % this.glyphAtlas.columns
            this.glyphUvArray[slotIndex * 2 + 1] = Math.floor(glyphIndex / this.glyphAtlas.columns)
        }

        // Mark attributes as needing update
        this.glyphAttribute.needsUpdate = true
        this.spiralGeometry.attributes.aDisplacedT.needsUpdate = true
    }
}
