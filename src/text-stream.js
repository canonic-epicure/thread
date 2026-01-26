import { DEFAULT_TEXT } from "./text.js";
const defaultConfig = {
    endpoint: 'http://localhost:8787/api/stream',
    prompt: 'Write an endless, poetic stream of short words and phrases on topic: \n' + DEFAULT_TEXT +
        '\nAvoid line breaks. Keep it uppercase',
    temperature: 0.8,
    maxTokens: 512,
    maxLength: 80000,
    refillThreshold: 30000,
    minUpdateIntervalMs: 250
};
export class TextStreamBuffer {
    constructor(initialText, maxLength) {
        this.text = initialText;
        this.maxLength = maxLength;
        this.enforceMaxLength();
    }
    getText() {
        return this.text;
    }
    append(chunk) {
        if (!chunk)
            return;
        this.text += sanitizeText(chunk);
        this.enforceMaxLength();
    }
    isBelowThreshold(threshold) {
        return this.text.length < threshold;
    }
    enforceMaxLength() {
        if (this.text.length > this.maxLength) {
            this.text = this.text.slice(-this.maxLength);
        }
    }
}
export class LlmTextStream {
    constructor(buffer, config, callbacks) {
        this.streaming = false;
        this.pendingRetry = null;
        this.lastUpdate = 0;
        this.buffer = buffer;
        this.config = { ...defaultConfig, ...config };
        this.callbacks = callbacks;
    }
    start() {
        this.ensureStreaming();
    }
    scheduleRetry(delayMs) {
        if (this.pendingRetry !== null) {
            window.clearTimeout(this.pendingRetry);
        }
        this.pendingRetry = window.setTimeout(() => {
            this.pendingRetry = null;
            this.ensureStreaming();
        }, delayMs);
    }
    ensureStreaming() {
        if (this.streaming)
            return;
        if (!this.buffer.isBelowThreshold(this.config.refillThreshold))
            return;
        void this.streamOnce();
    }
    emitUpdate() {
        const now = performance.now();
        if (now - this.lastUpdate < this.config.minUpdateIntervalMs)
            return;
        this.lastUpdate = now;
        this.callbacks.onUpdate(this.buffer.getText());
    }
    async streamOnce() {
        this.streaming = true;
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
            });
            if (!response.ok || !response.body) {
                throw new Error('Stream request failed');
            }
            await this.consumeSseStream(response.body);
        }
        catch (error) {
            this.callbacks.onError?.(error);
            this.scheduleRetry(2000);
        }
        finally {
            this.streaming = false;
            if (this.buffer.isBelowThreshold(this.config.refillThreshold)) {
                this.scheduleRetry(500);
            }
        }
    }
    async consumeSseStream(stream) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let done = false;
        while (!done) {
            const { value, done: readerDone } = await reader.read();
            done = readerDone;
            if (value) {
                buffer += decoder.decode(value, { stream: true });
                buffer = this.processSseBuffer(buffer);
            }
        }
    }
    processSseBuffer(buffer) {
        const lines = buffer.split('\n');
        const remaining = lines.pop() ?? '';
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:'))
                continue;
            const data = trimmed.replace(/^data:\s*/, '');
            if (data === '[DONE]') {
                continue;
            }
            try {
                const payload = JSON.parse(data);
                const delta = payload.choices?.[0]?.delta?.content;
                if (delta) {
                    this.buffer.append(delta);
                    this.emitUpdate();
                }
            }
            catch {
                continue;
            }
        }
        return remaining;
    }
}
function sanitizeText(value) {
    return value.replace(/\s+/g, ' ').toUpperCase();
}
