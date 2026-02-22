import { RingBuffer } from "./ring-buffer.js"
import { type CharSlot, TextStreamBuffer } from "./text-stream-buffer.js"

export class SpiralSlotRing extends RingBuffer<CharSlot> {
    textBuffer : TextStreamBuffer = null

    constructor(size : number, textBuffer : TextStreamBuffer) {
        super(size)
        this.textBuffer = textBuffer

        this.syncFromTextBuffer(textBuffer)
    }

    advance(slot : CharSlot) : void {
        this.shift()
        this.set(this.size - 1, slot ?? this.createBlankSlot())
    }

    syncFromTextBuffer(textBuffer : TextStreamBuffer) : void {
        const slots     = textBuffer.processed
        const startAt   = textBuffer.startAt
        const available = Math.max(0, slots.length - startAt)

        const fill : CharSlot[] = new Array(this.size)

        if (available === 0) {
            for (let i = 0; i < this.size; i++) {
                fill[ i ] = this.createBlankSlot()
            }
        } else if (available < this.size) {
            const padding = this.size - available
            for (let i = 0; i < padding; i++) {
                fill[ i ] = this.createBlankSlot()
            }
            for (let i = 0; i < available; i++) {
                fill[ padding + i ] = slots[ startAt + i ]
            }
        } else {
            for (let i = 0; i < this.size; i++) {
                fill[ i ] = slots[ startAt + i ]
            }
        }

        this.set(0, ...fill)

        this.textBuffer.advance(Math.min(available, this.size))
    }

    createBlankSlot() : CharSlot {
        return { char: ' ', readableDelta: 0, index: -1 }
    }
}