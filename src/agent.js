'use strict';
const { chat } = require('./ollama');
const { getWorkspaceContext } = require('./workspace');
const readFile = require('./tools/readFile');
const writeFile = require('./tools/writeFile');
const runShell = require('./tools/runShell');
const deleteFile = require('./tools/deleteFile');
const webSearch = require('./tools/webSearch');

const MAX_TURNS = 16;
const TOOL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/;

const ACTION_WORDS =
  /\b(write|create|modify|generate|build|add|make|delete|run|execute|install|deploy|refactor|fix|change|update|implement)\b/i;

function buildSystem(workspace, tree, model) {
  return `You are LlamaPilot — an AI code executor powered by ${model}. You are NOT just a text model. You MUST use tools to make real changes to files.

## Workspace
Path: ${workspace}
${tree}

## CRITICAL: How to use tools
When you need to take action, output a tool call on its own line using EXACTLY this format:
<tool_call>{"tool":"TOOL_NAME","args":{"argName":"value"}}</tool_call>

## Available Tools

**readFile** — Read a file before editing it
  args: { "path": "relative/path" }

**writeFile** — Create or overwrite a file (REQUIRED to apply all changes)
  Write EXACTLY what the user asked for — nothing more.
  If asked for console.log('hello world'), write console.log('hello world').
  Do NOT add Express, classes, or extra structure unless explicitly asked.
  args: { "path": "relative/path", "content": "complete file content" }

**runShell** — Run a shell command (user approval required)
  args: { "command": "npm install", "cwd": "optional/subdir" }

**deleteFile** — Delete a file permanently (user approval required)
  args: { "path": "relative/path" }

**webSearch** — Search for docs, examples, best practices
  args: { "query": "search terms" }

## Concrete examples

Reading then writing:
I'll read the file first to understand its structure.
<tool_call>{"tool":"readFile","args":{"path":"src/index.js"}}</tool_call>

Creating a new file:
<tool_call>{"tool":"writeFile","args":{"path":"src/utils.js","content":"'use strict';\n\nmodule.exports = {};"}}</tool_call>

Running a command:
<tool_call>{"tool":"runShell","args":{"command":"npm test"}}</tool_call>

Searching for docs:
<tool_call>{"tool":"webSearch","args":{"query":"node.js fs promises readFile"}}</tool_call>

## Rules

1. ALWAYS use tools — never just describe what you would do, actually do it.
2. Always readFile BEFORE editing an existing file.
3. writeFile must contain 100% of the file — no placeholders like "// rest of file".
4. One <tool_call> per message — wait for the result before the next action.
5. After finishing, list every file created or modified in a summary.
6. Destructive actions (runShell, deleteFile) will show the user an approval dialog.`;
}

async function runAgent({ messages, workspace, sendEvent, model }) {
  const usedModel = model || process.env.LLAMAPILOT_MODEL || 'deepseek-coder';
  const tree = await getWorkspaceContext(workspace);

  // Capture the user's original request before we mutate conv
  const originalUserMsg =
    [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const userWantsAction = ACTION_WORDS.test(originalUserMsg);

  const conv = [
    { role: 'system', content: buildSystem(workspace, tree, usedModel) },
    ...messages,
  ];

  // Show a thinking indicator immediately so the UI doesn't look frozen
  sendEvent({ type: 'thinking_start' });

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let raw;
    try {
      raw = await chat(conv, usedModel);
    } catch (err) {
      sendEvent({ type: 'thinking_done' });
      sendEvent({
        type: 'error',
        content: `Ollama error: ${err.message}\n\nMake sure Ollama is running and the model is pulled:\n  ollama pull ${usedModel}`,
      });
      return;
    }

    if (!raw || !raw.trim()) {
      sendEvent({ type: 'thinking_done' });
      sendEvent({
        type: 'error',
        content: 'Model returned an empty response. Try again.',
      });
      return;
    }

    const match = TOOL_RE.exec(raw);

    if (!match) {
      // Model gave a text response — check if it should have used a tool instead
      if (userWantsAction && turn === 0) {
        // Re-prompt once firmly
        conv.push({ role: 'assistant', content: raw });
        conv.push({
          role: 'user',
          content: `You described what to do but didn't actually do it. Use a tool call now:\n<tool_call>{"tool":"writeFile","args":{"path":"...","content":"..."}}</tool_call>\n\nDo not explain further — execute the action.`,
        });
        continue;
      }

      // Legitimate final response
      sendEvent({ type: 'thinking_done' });
      const cleaned = stripPadding(raw);
      sendEvent({ type: 'stream_start' });
      const tokens = cleaned.split(/(?<=\s)|(?=\s)/);
      for (const tok of tokens) {
        sendEvent({ type: 'stream_chunk', content: tok });
        await sleep(4);
      }
      sendEvent({ type: 'stream_done' });
      return;
    }

    // Show thinking done on first tool use
    if (turn === 0) sendEvent({ type: 'thinking_done' });

    // Show reasoning text before the tool call
    const before = raw.slice(0, match.index).trim();
    if (before) sendEvent({ type: 'agent_text', content: before });

    // Parse tool JSON
    let call;
    try {
      call = JSON.parse(match[1].trim());
    } catch {
      sendEvent({
        type: 'error',
        content: `Malformed tool JSON:\n${match[1]}`,
      });
      return;
    }

    if (!call.tool) {
      sendEvent({
        type: 'error',
        content: 'Model returned a tool call with no tool name.',
      });
      return;
    }

    sendEvent({ type: 'tool_start', tool: call.tool, args: call.args || {} });

    let result;
    try {
      result = await dispatch(call.tool, call.args || {}, workspace, sendEvent);
    } catch (err) {
      result = `Error: ${err.message}`;
    }

    sendEvent({ type: 'tool_done', tool: call.tool, result });

    // Notify UI to refresh file tree if we wrote or deleted something
    if (call.tool === 'writeFile' || call.tool === 'deleteFile') {
      sendEvent({ type: 'refresh_tree' });
    }

    conv.push({ role: 'assistant', content: raw });
    conv.push({
      role: 'user',
      content: `TOOL RESULT [${call.tool}]:\n${result}\n\nNext action:`,
    });
  }

  sendEvent({ type: 'thinking_done' });
  sendEvent({
    type: 'error',
    content: `Reached the maximum of ${MAX_TURNS} steps. Try breaking this into smaller tasks.`,
  });
}

async function dispatch(tool, args, workspace, sendEvent) {
  switch (tool) {
    case 'readFile':
      if (!args.path) throw new Error('readFile requires a path');
      return readFile(args.path, workspace);
    case 'writeFile':
      if (!args.path) throw new Error('writeFile requires a path');
      if (args.content === undefined)
        throw new Error('writeFile requires content');
      return writeFile(args.path, args.content, workspace);
    case 'runShell':
      if (!args.command) throw new Error('runShell requires a command');
      return runShell(args.command, workspace, args.cwd, sendEvent);
    case 'deleteFile':
      if (!args.path) throw new Error('deleteFile requires a path');
      return deleteFile(args.path, workspace, sendEvent);
    case 'webSearch':
      if (!args.query) throw new Error('webSearch requires a query');
      return webSearch(args.query);
    default:
      throw new Error(
        `Unknown tool "${tool}". Valid: readFile, writeFile, runShell, deleteFile, webSearch`,
      );
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { runAgent };
// Strips social filler the model sometimes prepends to responses
function stripPadding(text) {
  return text
    .replace(/^(thank you[\s\S]{0,120}?\n)/i, '')
    .replace(/^(great[!,][\s\S]{0,120}?\n)/i, '')
    .replace(/^(of course[!,][\s\S]{0,80}?\n)/i, '')
    .replace(/^(sure[!,][\s\S]{0,80}?\n)/i, '')
    .replace(/^(i('ve| have) (created|written|added|updated)[\s\S]{0,200}?\n\n)/i, '')
    .trim();
}