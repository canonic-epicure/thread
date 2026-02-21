export class RingBuffer<T> {
    private buffer : T[] = []
    private start : number = 0

    constructor(size : number) {
        if (size <= 0) {
            throw new Error('RingBuffer size must be greater than 0')
        }
        this.buffer = new Array(size)
    }

    push(...items : T[]) : void {
        const length = this.buffer.length

        for (let i = 0; i < items.length; i++) {
            this.buffer[ (this.start + i) % length ] = items[ i ]
        }
    }

    shift() {
        const item = this.buffer[ this.start ]
        this.start = (this.start + 1) % this.buffer.length
        return item
    }

    get size() : number {
        return this.buffer.length
    }

    get(index : number) : T {
        return this.buffer[ (this.start + index) % this.buffer.length ]
    }

    set(index : number, ...items : T[]) {
        const length = this.buffer.length

        for (let i = 0; i < items.length; i++) {
            this.buffer[ (this.start + index + i) % length ] = items[ i ]
        }
    }
}