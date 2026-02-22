export type CharSlot = {
    index : number
    char : string
    readableDelta : number
}

export class TextStreamBuffer {
    chunkSize : number = 0
    shuffle_radius : number = 15

    pending : string = ''

    uniqueChars : Set<string> = new Set([ ' ' ])
    processed : CharSlot[] = []
    startAt : number = 0

    state : number = 0


    constructor(initialText : string, chunkSize : number = 500) {
        this.chunkSize = chunkSize
        this.append(initialText, true)
    }

    advance(available : number) {
        if (this.startAt < this.processed.length) {
            this.startAt += available

            this.state++

            if (this.startAt > this.chunkSize) {
                this.processed.slice(0, this.startAt)
                this.processed = this.processed.slice(this.startAt)
                this.startAt   = 0
            }
        }
    }


    shift() : CharSlot | null {
        if (this.startAt < this.processed.length - 1) {
            const current = this.processed[ this.startAt++ ]

            this.state++

            if (this.startAt > this.chunkSize) {
                this.processed.slice(0, this.startAt)
                this.processed = this.processed.slice(this.startAt)
                this.startAt   = 0
            }

            return current
        } else
            return null
    }


    get text() : string {
        return this.processed.slice(this.startAt).map(char => char.char).join('')
    }

    get length() : number {
        return this.processed.length - this.startAt
    }


    sanitizeText(value : string) : string {
        return value.replace(/\s+/g, ' ').replace(/[^a-zA-Z0-9 ]/g, '').toUpperCase()
    }


    append(chunk : string, force : boolean = false) : void {
        const sanitized = this.sanitizeText(chunk)
        if (!sanitized) return

        for (const char of sanitized) {
            this.uniqueChars.add(char)
        }

        this.pending += sanitized

        if (this.pending.length >= this.chunkSize || force) {
            const chunks = Math.floor(this.pending.length / this.chunkSize)

            for (let i = 0; i < chunks; i++) {
                const chunk = this.pending.slice(i * this.chunkSize, (i + 1) * this.chunkSize)

                const chars = Array.from(chunk)
                    .map((char, index) => {
                        const shuffled = index + Math.floor(Math.random() * this.shuffle_radius * 2)
                            - this.shuffle_radius

                        return { char, index, shuffled }
                    })

                chars.sort((a, b) => a.shuffled - b.shuffled)

                const slots = chars.map((char) : CharSlot => {
                    return { index: char.index, char: char.char, readableDelta: 0 }
                })

                slots.forEach((slot, index) => {
                    slot.readableDelta = index - chars[ index ].index
                })

                slots.sort((a, b) => a.index - b.index)

                this.processed.push(...slots)
            }

            this.pending = this.pending.slice(chunks * this.chunkSize)
            this.state++
        }
    }
}