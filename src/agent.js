'use strict';
const { chat } = require('./ollama');
const { getWorkspaceContext } = require('./workspace');
const readFile = require('./tools/readFile');
const writeFile = require('./tools/writeFile');
const runShell = require('./tools/runShell');
const deleteFile = require('./tools/deleteFile');
const webSearch = require('./tools/webSearch');

const MAX_TURNS = 12;
const TOOL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/;

function buildSystem(workspace, tree) {
  return `You are LlamaPilot — a local AI coding assistant (deepseek-coder via Ollama).

## Workspace
Path: ${workspace}
${tree}

## Tools
Output a tool call using EXACTLY this format (one per message, nothing on the same line):
<tool_call>{"tool":"TOOL_NAME","args":{...}}</tool_call>

readFile   — read a workspace file
  args: { "path": "relative/path" }

writeFile  — create or overwrite a file
  args: { "path": "relative/path", "content": "full file content" }

runShell   — run a shell command (user approval required)
  args: { "command": "npm install", "cwd": "optional/subdir" }

deleteFile — delete a file (user approval required)
  args: { "path": "relative/path" }

webSearch  — search for code examples / docs
  args: { "query": "search terms" }

## Rules
- Read files before editing them to understand existing patterns.
- Use writeFile to actually make changes — do not just show code snippets.
- Explain what you are doing before and after each tool call.
- Destructive actions (runShell, deleteFile) will show an approval dialog.
- After completing a task, give a brief summary of all changes made.`;
}

async function runAgent({ messages, workspace, sendEvent }) {
  const tree = await getWorkspaceContext(workspace);
  const conv = [
    { role: 'system', content: buildSystem(workspace, tree) },
    ...messages,
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const raw = await chat(conv);
    const match = TOOL_RE.exec(raw);

    if (!match) {
      // Final response — word-by-word stream to UI
      sendEvent({ type: 'stream_start' });
      for (const tok of raw.split(/(?<=\s)|(?=\s)/)) {
        sendEvent({ type: 'stream_chunk', content: tok });
        await sleep(5);
      }
      sendEvent({ type: 'stream_done' });
      return;
    }

    // Show any reasoning text before the tool call
    const before = raw.slice(0, match.index).trim();
    if (before) sendEvent({ type: 'agent_text', content: before });

    // Parse the tool call JSON
    let call;
    try {
      call = JSON.parse(match[1].trim());
    } catch {
      sendEvent({ type: 'error', content: `Bad tool JSON:\n${match[1]}` });
      return;
    }

    sendEvent({ type: 'tool_start', tool: call.tool, args: call.args });

    let result;
    try {
      result = await dispatch(call.tool, call.args, workspace, sendEvent);
    } catch (e) {
      result = `Error: ${e.message}`;
    }

    sendEvent({ type: 'tool_done', tool: call.tool, result });

    // Feed result back into the conversation and loop
    conv.push({ role: 'assistant', content: raw });
    conv.push({
      role: 'user',
      content: `<tool_result tool="${call.tool}">\n${result}\n</tool_result>\n\nContinue.`,
    });
  }

  sendEvent({
    type: 'error',
    content: 'Max iterations reached without a final response.',
  });
}

async function dispatch(tool, args, workspace, sendEvent) {
  switch (tool) {
    case 'readFile':
      return readFile(args.path, workspace);
    case 'writeFile':
      return writeFile(args.path, args.content, workspace);
    case 'runShell':
      return runShell(args.command, workspace, args.cwd, sendEvent);
    case 'deleteFile':
      return deleteFile(args.path, workspace, sendEvent);
    case 'webSearch':
      return webSearch(args.query);
    default:
      throw new Error(`Unknown tool: "${tool}"`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { runAgent };
