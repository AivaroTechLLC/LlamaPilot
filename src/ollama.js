'use strict';
const fetch = require('node-fetch');

const BASE = process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = process.env.LLAMAPILOT_MODEL || 'deepseek-coder:latest';

async function chat(messages, model = MODEL) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: {
        temperature: 0.1, // low = more precise, less rambling
        num_ctx: 8192, // enough for multi-file tasks
        repeat_penalty: 1.1, // stops the model repeating itself
        stop: [
          // hard-stop tokens — kills social padding
          '<|end|>',
          '<tool_result>',
          'Human:',
          'User:',
          'Assistant:',
        ],
      },
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.message?.content ?? '';
}

async function chatStream(messages, model = MODEL, onChunk) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: {
        temperature: 0.1,
        num_ctx: 8192,
        repeat_penalty: 1.1,
      },
    }),
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
