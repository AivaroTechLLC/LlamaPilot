'use strict';
/* global llama */

// ── State ─────────────────────────────────────────────────────────────────────
let history = []; // [{role, content}]
let streaming = false;
let streamTarget = null; // DOM element being streamed into

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const workspace = await llama.getWorkspace();
  document.getElementById('workspace-label').textContent =
    workspace.split('/').pop() || workspace;
  document.title = `LlamaPilot — ${workspace.split('/').pop()}`;

  await loadTree('.');
  setupListeners();
  addMessage(
    'agent',
    'LlamaPilot ready. Workspace: `' +
      workspace +
      '`\n\nWhat would you like to build?',
  );
});

// ── File tree ─────────────────────────────────────────────────────────────────
async function loadTree(relPath, parentEl = null) {
  const container = parentEl || document.getElementById('file-tree');
  const entries = await llama.listDir(relPath).catch(() => []);

  container.innerHTML = '';
  for (const e of entries) {
    const item = document.createElement('div');
    item.className = `tree-item ${e.isDir ? 'dir' : 'file'}`;
    item.style.paddingLeft = `${12 + (relPath === '.' ? 0 : 8)}px`;
    item.innerHTML = `<span class="icon">${e.isDir ? '📁' : '📄'}</span><span>${e.name}</span>`;
    item.title = e.path;

    if (!e.isDir) {
      item.addEventListener('click', async () => {
        const content = await llama.readFile(e.path).catch(() => null);
        if (content !== null) {
          insertUserMessage(`Show me the file: ${e.path}`);
          addMessage('agent', `\`\`\`\n${content}\n\`\`\``);
        }
      });
    }
    container.appendChild(item);
  }
}

// ── Send message ──────────────────────────────────────────────────────────────
function setupListeners() {
  const input = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    // Enter to submit, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Agent events from main process
  llama.onAgentEvent(handleAgentEvent);

  // Approval requests
  llama.onApprovalRequest(({ id, kind, detail }) => {
    showApproval(id, kind, detail);
  });
}

async function sendMessage() {
  if (streaming) return;
  const input = document.getElementById('user-input');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  input.style.height = '';

  insertUserMessage(text);
  history.push({ role: 'user', content: text });

  document.getElementById('send-btn').disabled = true;
  streaming = true;

  await llama.chat(history);
}

function insertUserMessage(text) {
  addMessage('user', text);
}

// ── Agent event handler ───────────────────────────────────────────────────────
function handleAgentEvent(evt) {
  switch (evt.type) {
    case 'stream_start':
      streamTarget = addMessage('agent', '');
      streamTarget.classList.add('cursor');
      break;

    case 'stream_chunk':
      if (streamTarget) {
        streamTarget.textContent += evt.content;
        scrollToBottom();
      }
      break;

    case 'stream_done':
      if (streamTarget) {
        streamTarget.classList.remove('cursor');
        const finalText = streamTarget.textContent;
        history.push({ role: 'assistant', content: finalText });
        streamTarget = null;
      }
      streaming = false;
      document.getElementById('send-btn').disabled = false;
      break;

    case 'agent_text': {
      const el = addMessage('agent', '');
      el.textContent = evt.content;
      break;
    }

    case 'tool_start': {
      const card = addToolCard(evt.tool, evt.args, 'running…', '');
      card.dataset.tool = evt.tool;
      break;
    }

    case 'tool_done': {
      // Find the last tool card for this tool and update it
      const cards = [...document.querySelectorAll('.tool-card')];
      const card = cards.reverse().find((c) => c.dataset.tool === evt.tool);
      if (card) {
        const status = card.querySelector('.tool-status');
        const body = card.querySelector('.tool-card-body');
        if (status) {
          status.textContent = 'done';
          status.className = 'tool-status ok';
        }
        if (body) {
          body.textContent = truncate(evt.result, 400);
        }
      }
      break;
    }

    case 'error': {
      const el = addMessage('agent', `⚠ ${evt.content}`);
      el.style.color = '#f44747';
      streaming = false;
      document.getElementById('send-btn').disabled = false;
      break;
    }
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function addMessage(role, text) {
  const msgs = document.getElementById('messages');
  const msg = document.createElement('div');
  msg.className = `msg ${role}`;

  const hdr = document.createElement('div');
  hdr.className = 'msg-header';
  hdr.textContent = role === 'user' ? 'You' : 'LlamaPilot';

  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = text;

  msg.appendChild(hdr);
  msg.appendChild(body);
  msgs.appendChild(msg);
  scrollToBottom();
  return body;
}

function addToolCard(tool, args, status, result) {
  const msgs = document.getElementById('messages');
  const card = document.createElement('div');
  card.className = 'tool-card';

  const argsStr = Object.entries(args || {})
    .map(
      ([k, v]) =>
        `${k}: ${typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : v}`,
    )
    .join('  ');

  card.innerHTML = `
    <div class="tool-card-header">
      <span class="tool-name">${tool}</span>
      <span class="tool-args" style="color:#858585;font-size:11px">${argsStr}</span>
      <span class="tool-status" style="margin-left:auto">${status}</span>
    </div>
    <div class="tool-card-body">${result}</div>
  `;

  msgs.appendChild(card);
  scrollToBottom();
  return card;
}

function showApproval(id, kind, detail) {
  const overlay = document.getElementById('approval-overlay');
  document.getElementById('approval-kind').textContent =
    kind === 'shell' ? '⚡ Run shell command?' : '🗑 Delete file?';
  document.getElementById('approval-detail').textContent = detail;
  overlay.classList.remove('hidden');

  const cleanup = () => overlay.classList.add('hidden');

  document.getElementById('btn-allow').onclick = () => {
    cleanup();
    llama.sendApproval(id, true);
  };
  document.getElementById('btn-deny').onclick = () => {
    cleanup();
    llama.sendApproval(id, false);
  };
}

function scrollToBottom() {
  const wrap = document.getElementById('chat-wrap');
  wrap.scrollTop = wrap.scrollHeight;
}

function truncate(str, n) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + '\n…(truncated)' : str;
}
