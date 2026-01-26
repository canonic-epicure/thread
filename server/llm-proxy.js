import http from 'node:http'
import { DEFAULT_TEXT } from '../src/text.js'

const PORT = Number.parseInt(process.env.PORT ?? '8787', 10)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ''

const defaultModel = 'mistralai/mistral-small-3.1-24b-instruct:free'
const defaultPrompt =
    'Write an endless, poetic stream of short words and phrases. ' + DEFAULT_TEXT +
    'Avoid line breaks. Keep it uppercase'

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

    if (!OPENROUTER_API_KEY) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Missing OPENROUTER_API_KEY' }))
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
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON body' }))
        return
    }

    const prompt = body.prompt ?? defaultPrompt
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
        upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': body.referer ?? 'http://localhost:5173',
                'X-Title': body.title ?? 'thread-text-stream'
            },
            body: JSON.stringify(payload)
        })
    } catch (error) {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Upstream connection failed' }))
        return
    }

    if (!upstream.ok || !upstream.body) {
        const errorText = await upstream.text().catch(() => '')
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
    } finally {
        res.end()
    }
})

server.listen(PORT, () => {
    console.log(`LLM proxy listening on http://localhost:${PORT}`)
})
