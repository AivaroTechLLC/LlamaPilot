'use strict';
const fetch = require('node-fetch');

const BASE = process.env.OLLAMA_HOST || 'http://localhost:11434';
// Recommended models for code assistance (in order of preference):
// - mistral:7b (32k context, good reasoning) ✓ Recommended
// - neural-chat:7b (optimized for chat)
// - deepseek-coder:6.7b or :33b (best for code)
// - qwen2:7b or :14b (general coding)
const MODEL = process.env.LLAMAPILOT_MODEL || 'mistral:7b';

/** Non-streaming — returns full assistant content string */
async function chat(messages, model = MODEL) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message?.content ?? '';
}

/** Streaming — calls onChunk(token) per token, returns full content */
async function chatStream(messages, model = MODEL, onChunk) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);

  let full = '';
  const dec = new TextDecoder();
  for await (const chunk of res.body) {
    for (const line of dec.decode(chunk, { stream: true }).split('\n')) {
      if (!line.trim()) continue;
      try {
        const tok = JSON.parse(line).message?.content ?? '';
        if (tok) {
          full += tok;
          onChunk(tok);
        }
      } catch {
        /* partial line */
      }
    }
  }
  return full;
}

module.exports = { chat, chatStream };
