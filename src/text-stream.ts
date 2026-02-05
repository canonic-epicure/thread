import { DEFAULT_TEXT } from "./text.js"

type TextStreamConfig = {
    endpoint: string
    prompt: string
    model?: string
    temperature: number
    maxTokens: number
    refillThreshold: number
    minUpdateIntervalMs: number
}

type TextStreamCallbacks = {
    onUpdate: (buffer: TextStreamBuffer) => void
    onError?: (error: Error) => void
}

const defaultConfig: TextStreamConfig = {
    endpoint: 'http://localhost:8787/api/stream',
    prompt:
        'Write an endless, poetic stream of short words and phrases on topic: \n' + DEFAULT_TEXT +
        'Do not just repeat the meanings or patterns from the topic. Let it only influence the result.' +
        '\nAvoid line breaks. Keep it uppercase',
    temperature: 0.8,
    maxTokens: 512,
    refillThreshold: 30000,
    minUpdateIntervalMs: 250
}

export type CharSlot = {
    char: string
    originalDelta: number
}

export class TextStreamBuffer {
    minChunkSize: number = 500
    shuffle_radius: number = 15

    pending : string = ''

    uniqueChars: Set<string> = new Set([' '])

    visibleSlots: CharSlot[] = []
    visibleStartAt: number = 0


    constructor(initialText: string) {
        this.append(initialText)
    }

    shift() {
        this.visibleStartAt++

        if (this.visibleStartAt > this.minChunkSize) {
            this.visibleSlots   = this.visibleSlots.slice(this.visibleStartAt)
            this.visibleStartAt = 0
        }
    }


    get text(): string {
        return this.visibleSlots.slice(this.visibleStartAt).map(char => char.char).join('')
    }

    get length(): number {
        return this.visibleSlots.length - this.visibleStartAt
    }


    append(chunk: string): void {
        const sanitized = sanitizeText(chunk)
        if (!sanitized) return

        for (const char of sanitized) {
            this.uniqueChars.add(char)
        }

        this.pending += sanitized

        if (this.pending.length > this.minChunkSize) {
            const chars = Array.from(this.pending)
                .map((char, index) => {
                    const shuffled = index + Math.floor(Math.random() * this.shuffle_radius * 2) - this.shuffle_radius

                    return { char, index, shuffled }
                })

            chars.sort((a, b) => a.shuffled - b.shuffled)

            const slots = chars.map((char) : CharSlot => {
                return { char: char.char, originalDelta : 0 }
            })

            slots.forEach((slot, index) => {
                slot.originalDelta = index - chars[index].index
            })

            this.visibleSlots.push(...slots)

            this.pending = ''
        }
    }
}

export class LlmTextStream {
    private buffer: TextStreamBuffer
    private config: TextStreamConfig
    private callbacks: TextStreamCallbacks
    private streaming = false
    private pendingRetry: number | null = null
    private lastUpdate = 0

    constructor(
        buffer: TextStreamBuffer,
        config: Partial<TextStreamConfig>,
        callbacks: TextStreamCallbacks
    ) {
        this.buffer    = buffer
        this.config    = { ...defaultConfig, ...config }
        this.callbacks = callbacks
    }

    start(): void {
        this.ensureStreaming()
    }

    private scheduleRetry(delayMs: number) {
        if (this.pendingRetry !== null) {
            window.clearTimeout(this.pendingRetry)
        }
        this.pendingRetry = window.setTimeout(() => {
            this.pendingRetry = null
            this.ensureStreaming()
        }, delayMs)
    }

    private ensureStreaming() {
        if (this.streaming) return
        if (this.buffer.length >= this.config.refillThreshold) return
        void this.streamOnce()
    }

    private emitUpdate() {
        const now = performance.now()
        if (now - this.lastUpdate < this.config.minUpdateIntervalMs) return
        this.lastUpdate = now
        this.callbacks.onUpdate(this.buffer)
    }

    private async streamOnce() {
        this.streaming = true
        try {
            const response = await fetch(this.config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: this.config.prompt,
                    model: this.config.model,
                    temperature: this.config.temperature,
                    max_tokens: this.config.maxTokens
                })
            })

            if (!response.ok || !response.body) {
                throw new Error('Stream request failed')
            }

            await this.consumeSseStream(response.body)
        } catch (error) {
            this.callbacks.onError?.(error as Error)
            this.scheduleRetry(2000)
        } finally {
            this.streaming = false
            if (this.buffer.length < this.config.refillThreshold) {
                this.scheduleRetry(500)
            }
        }
    }

    private async consumeSseStream(stream: ReadableStream<Uint8Array>) {
        const reader  = stream.getReader()
        const decoder = new TextDecoder()
        let buffer    = ''
        let done      = false

        while (!done) {
            const { value, done: readerDone } = await reader.read()
            done                              = readerDone
            if (value) {
                buffer += decoder.decode(value, { stream: true })
                buffer  = this.processSseBuffer(buffer)
            }
        }
    }

    private processSseBuffer(buffer: string): string {
        const lines     = buffer.split('\n')
        const remaining = lines.pop() ?? ''

        for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const data = trimmed.replace(/^data:\s*/, '')
            if (data === '[DONE]') {
                continue
            }
            try {
                const payload = JSON.parse(data) as {
                    choices?: Array<{ delta?: { content?: string } }>
                }
                const delta   = payload.choices?.[0]?.delta?.content
                if (delta) {
                    this.buffer.append(delta)
                    this.emitUpdate()
                }
            } catch {
                continue
            }
        }

        return remaining
    }
}

function sanitizeText(value: string): string {
    return value.replace(/\s+/g, ' ').toUpperCase()
}
