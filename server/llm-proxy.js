import 'dotenv/config'
import http from 'node:http'
import { DEFAULT_TEXT } from '../src/text.js'

const PORT = Number.parseInt(process.env.PORT ?? '8787', 10)
const NEBIUS_API_KEY = process.env.NEBIUS_API_KEY ?? ''
const NEBIUS_BASE_URL = process.env.NEBIUS_BASE_URL ?? 'https://api.studio.nebius.ai/v1'

const defaultModel =
    process.env.NEBIUS_MODEL ?? 'meta-llama/Meta-Llama-3.1-8B-Instruct'
const defaultPrompt =
    'Write an endless, poetic stream of short words and phrases on this topic:\n' + DEFAULT_TEXT +
    '\nAvoid line breaks. Keep it uppercase'
const PROMPT_MAX_CHARS = 5000

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
    }

    if (req.url !== '/api/stream' || req.method !== 'POST') {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found' }))
        return
    }

    if (!NEBIUS_API_KEY) {
        console.error('[llm-proxy] Missing NEBIUS_API_KEY')
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing NEBIUS_API_KEY' }))
        return
    }

    const chunks = []
    for await (const chunk of req) {
        chunks.push(chunk)
    }

    let body = {}
    try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
    } catch {
        console.error('[llm-proxy] Invalid JSON body')
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
        return
    }

    const rawPrompt = body.prompt ?? defaultPrompt
    const { prompt, truncated } = clampPrompt(rawPrompt, PROMPT_MAX_CHARS)
    if (truncated) {
        console.warn('[llm-proxy] Prompt truncated', {
            maxChars: PROMPT_MAX_CHARS,
            originalLength: rawPrompt.length
        })
    }
    const model = body.model ?? defaultModel
    const temperature = body.temperature ?? 0.8
    const max_tokens = body.max_tokens ?? 512

    const payload = {
        model,
        stream: true,
        temperature,
        max_tokens,
        messages: [{ role: 'user', content: prompt }]
    }

    let upstream
    try {
        upstream = await fetch(`${NEBIUS_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${NEBIUS_API_KEY}`,
                'Content-Type': 'application/json',
                Accept: 'text/event-stream'
            },
            body: JSON.stringify(payload)
        })
    } catch (error) {
        console.error('[llm-proxy] Upstream connection failed', error)
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Upstream connection failed' }))
        return
    }

    if (!upstream.ok || !upstream.body) {
        const errorText = await upstream.text().catch(() => '')
        console.error('[llm-proxy] Upstream error', {
            status: upstream.status,
            statusText: upstream.statusText,
            detail: errorText
        })
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Upstream error', detail: errorText }))
        return
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
    })

    const reader = upstream.body.getReader()
    const decoder = new TextDecoder()
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const text = decoder.decode(value, { stream: true })
            res.write(text)
        }
    } catch (error) {
        console.error('[llm-proxy] Stream relay failed', error)
    } finally {
        res.end()
    }
})

server.listen(PORT, () => {
    console.log(`LLM proxy listening on http://localhost:${PORT}`)
})

function clampPrompt(prompt, maxChars) {
    const safePrompt = typeof prompt === 'string' ? prompt : String(prompt ?? '')
    if (safePrompt.length <= maxChars) {
        return { prompt: safePrompt, truncated: false }
    }
    return { prompt: safePrompt.slice(0, maxChars), truncated: true }
}
