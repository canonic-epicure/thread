import * as THREE from 'three'

const GLYPH_CELL_SIZE = 64
const GLYPH_FONT_SIZE = 64
const GLYPH_ATLAS_COLUMNS = 16
const GLYPH_ATLAS_ROWS = 4
const DEFAULT_SEED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ '

type GlyphAtlasOptions = {
    columns?: number
    rows?: number
    seedChars?: string
}

export class GlyphAtlas {
    texture: THREE.CanvasTexture
    glyphMap: Map<string, number>
    columns: number
    rows: number

    private canvas: HTMLCanvasElement
    private ctx: CanvasRenderingContext2D
    private glyphsByIndex: string[]
    private fontFamily: string

    constructor(fontFamily: string, options?: GlyphAtlasOptions) {
        this.columns = options?.columns ?? GLYPH_ATLAS_COLUMNS
        this.rows = options?.rows ?? GLYPH_ATLAS_ROWS
        this.fontFamily = fontFamily
        this.glyphMap = new Map<string, number>()
        this.glyphsByIndex = []

        this.canvas = document.createElement('canvas')
        this.canvas.width = this.columns * GLYPH_CELL_SIZE
        this.canvas.height = this.rows * GLYPH_CELL_SIZE
        const ctx = this.canvas.getContext('2d')
        if (!ctx) {
            throw new Error('Failed to get glyph atlas context')
        }
        this.ctx = ctx
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
        this.applyFont()

        this.texture = new THREE.CanvasTexture(this.canvas)
        this.texture.minFilter = THREE.LinearFilter
        this.texture.magFilter = THREE.LinearFilter
        this.texture.generateMipmaps = false
        this.texture.needsUpdate = true

        const seed = options?.seedChars ?? DEFAULT_SEED
        this.ensureChars(seed.split(''))
    }

    setFontFamily(fontFamily: string) {
        if (this.fontFamily === fontFamily) {
            return
        }
        this.fontFamily = fontFamily
        this.applyFont()
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
        for (let i = 0; i < this.glyphsByIndex.length; i += 1) {
            const char = this.glyphsByIndex[i]
            if (char) {
                this.drawGlyph(char, i)
            }
        }
        this.texture.needsUpdate = true
    }

    ensureChars(chars: string[]): boolean {
        let added = false
        let capacityReached = false
        for (const char of chars) {
            if (this.glyphMap.has(char)) {
                continue
            }
            const nextIndex = this.glyphsByIndex.length
            if (nextIndex >= this.columns * this.rows) {
                capacityReached = true
                continue
            }
            this.glyphMap.set(char, nextIndex)
            this.glyphsByIndex[nextIndex] = char
            this.drawGlyph(char, nextIndex)
            added = true
        }
        if (capacityReached) {
            console.warn(
                `GlyphAtlas is full (${this.columns}x${this.rows}). Skipping new glyphs.`
            )
        }
        if (added) {
            this.texture.needsUpdate = true
        }
        return added
    }

    dispose() {
        this.texture.dispose()
    }

    private applyFont() {
        this.ctx.fillStyle = 'white'
        this.ctx.textAlign = 'center'
        this.ctx.textBaseline = 'middle'
        this.ctx.font = `bold ${GLYPH_FONT_SIZE}px ${this.fontFamily}`
    }

    private drawGlyph(char: string, index: number) {
        const col = index % this.columns
        const row = Math.floor(index / this.columns)
        const x = col * GLYPH_CELL_SIZE
        const y = row * GLYPH_CELL_SIZE
        this.ctx.clearRect(x, y, GLYPH_CELL_SIZE, GLYPH_CELL_SIZE)
        const cx = x + GLYPH_CELL_SIZE / 2
        const cy = y + GLYPH_CELL_SIZE / 2
        this.ctx.fillText(char, cx, cy)
    }
}
