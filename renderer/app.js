'use strict';
/* global llama */

let history = [];
let streaming = false;
let streamTarget = null;

// ── Init ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const workspace = await llama.getWorkspace();
  // Works on both Windows (backslash) and Unix (forward slash)
  const folderName =
    workspace.split(/[\\/]/).filter(Boolean).pop() || workspace;
  document.getElementById('workspace-label').textContent = folderName;
  document.title = `LlamaPilot — ${folderName}`;

  await loadTree('.');
  setupListeners();
  addMessage(
    'agent',
    'LlamaPilot ready.\n\nWorkspace: `' +
      workspace +
      '`\n\nWhat would you like to build?',
  );
});

// ── Markdown renderer (no external deps) ─────────────────────────────────────
function renderMarkdown(text) {
  const div = document.createElement('div');
  div.className = 'msg-body rendered';

  // Split into fenced code blocks vs prose
  const parts = text.split(/(```[\s\S]*?```)/g);
  for (const part of parts) {
    if (part.startsWith('```')) {
      const lines = part.slice(3, -3).split('\n');
      const lang = lines[0].trim();
      const code = lines.slice(lang ? 1 : 0).join('\n');
      const pre = document.createElement('pre');
      const codeEl = document.createElement('code');
      if (lang) codeEl.className = `lang-${lang}`;
      codeEl.textContent = code;
      pre.appendChild(codeEl);
      div.appendChild(pre);
    } else {
      // Process inline elements line by line
      const lines = part.split('\n');
      for (const line of lines) {
        if (!line.trim()) {
          div.appendChild(document.createElement('br'));
          continue;
        }

        const p = document.createElement('p');
        // Bold **text**
        let html = line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/`([^`]+)`/g, '<code>$1</code>');
        p.innerHTML = html;
        div.appendChild(p);
      }
    }
  }
  return div;
}

// ── File tree ─────────────────────────────────────────────────────────────────
async function loadTree(relPath, parentEl = null) {
  const container = parentEl || document.getElementById('file-tree');
  const entries = await llama.listDir(relPath).catch(() => []);
  container.innerHTML = '';

  for (const e of entries) {
    const item = document.createElement('div');
    const depth = relPath === '.' ? 0 : relPath.split('/').length;
    item.className = `tree-item ${e.isDir ? 'dir' : 'file'}`;
    item.style.paddingLeft = `${12 + depth * 12}px`;
    item.innerHTML = `<span class="icon">${e.isDir ? '📁' : '📄'}</span><span>${e.name}</span>`;
    item.title = e.path;

    if (e.isDir) {
      let expanded = false;
      const children = document.createElement('div');
      children.className = 'tree-children';
      item.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        expanded = !expanded;
        item.querySelector('.icon').textContent = expanded ? '📂' : '📁';
        if (expanded) {
          await loadTree(e.path, children);
          item.after(children);
        } else {
          children.remove();
        }
      });
    } else {
      item.addEventListener('click', async () => {
        const content = await llama.readFile(e.path).catch(() => null);
        if (content !== null) {
          addMessage('user', `Show me: ${e.path}`);
          history.push({
            role: 'user',
            content: `Show me the file: ${e.path}`,
          });
          const body = addRawMessage('agent', '');
          body.innerHTML = `<pre><code>${escHtml(content)}</code></pre>`;
        }
      });
    }
    container.appendChild(item);
  }
}

// ── Listeners ─────────────────────────────────────────────────────────────────
function setupListeners() {
  const input = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');

  sendBtn.addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  llama.onAgentEvent(handleAgentEvent);
  llama.onApprovalRequest(({ id, kind, detail }) =>
    showApproval(id, kind, detail),
  );
}

async function sendMessage() {
  if (streaming) return;
  const input = document.getElementById('user-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  addMessage('user', text);
  history.push({ role: 'user', content: text });

  document.getElementById('send-btn').disabled = true;
  streaming = true;

  await llama.chat(history);
}

// ── Agent event handler ───────────────────────────────────────────────────────
function handleAgentEvent(evt) {
  switch (evt.type) {
    case 'thinking_start':
      addThinkingIndicator();
      break;

    case 'thinking_done':
      removeThinkingIndicator();
      break;

    case 'stream_start':
      streamTarget = addRawMessage('agent', '');
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
        // Re-render as markdown
        const rendered = renderMarkdown(finalText);
        streamTarget.replaceWith(rendered);
        history.push({ role: 'assistant', content: finalText });
        streamTarget = null;
      }
      streaming = false;
      document.getElementById('send-btn').disabled = false;
      break;

    case 'agent_text': {
      const rendered = renderMarkdown(evt.content);
      document.getElementById('messages').appendChild(rendered);
      scrollToBottom();
      break;
    }

    case 'tool_start': {
      const card = addToolCard(evt.tool, evt.args, 'running…', '');
      card.dataset.tool = evt.tool;
      break;
    }

    case 'tool_done': {
      const cards = [...document.querySelectorAll('.tool-card')];
      const card = cards.reverse().find((c) => c.dataset.tool === evt.tool);
      if (card) {
        card.querySelector('.tool-status').textContent = 'done';
        card.querySelector('.tool-status').className = 'tool-status ok';
        card.querySelector('.tool-card-body').textContent = truncate(
          evt.result,
          500,
        );
      }
      break;
    }

    case 'refresh_tree':
      loadTree('.');
      break;

    case 'error': {
      removeThinkingIndicator();
      const el = addRawMessage('agent', `⚠ ${evt.content}`);
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

  const body = renderMarkdown(text);
  if (role === 'user') {
    body.className = 'msg-body user-body';
    body.textContent = text;
  }

  msg.appendChild(hdr);
  msg.appendChild(body);
  msgs.appendChild(msg);
  scrollToBottom();
  return body;
}

// Raw message — returns body element for streaming into
function addRawMessage(role, text) {
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
        `${k}: ${typeof v === 'string' && v.length > 50 ? v.slice(0, 50) + '…' : v}`,
    )
    .join('  ');

  card.innerHTML = `
    <div class="tool-card-header">
      <span class="tool-name">${escHtml(tool)}</span>
      <span class="tool-args">${escHtml(argsStr)}</span>
      <span class="tool-status" style="margin-left:auto">${status}</span>
    </div>
    <div class="tool-card-body">${escHtml(result)}</div>
  `;
  msgs.appendChild(card);
  scrollToBottom();
  return card;
}

function addThinkingIndicator() {
  removeThinkingIndicator();
  const msgs = document.getElementById('messages');
  const el = document.createElement('div');
  el.id = 'thinking-indicator';
  el.className = 'msg agent';
  el.innerHTML = `
    <div class="msg-header">LlamaPilot</div>
    <div class="msg-body thinking-body">
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      <span style="margin-left:8px;color:var(--muted);font-size:12px">Thinking…</span>
    </div>`;
  msgs.appendChild(el);
  scrollToBottom();
}

function removeThinkingIndicator() {
  document.getElementById('thinking-indicator')?.remove();
}

function showApproval(id, kind, detail) {
  const overlay = document.getElementById('approval-overlay');
  document.getElementById('approval-kind').textContent =
    kind === 'shell' ? '⚡ Run shell command?' : '🗑 Delete file?';
  document.getElementById('approval-detail').textContent = detail;
  overlay.classList.remove('hidden');

  document.getElementById('btn-allow').onclick = () => {
    overlay.classList.add('hidden');
    llama.sendApproval(id, true);
  };
  document.getElementById('btn-deny').onclick = () => {
    overlay.classList.add('hidden');
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

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
