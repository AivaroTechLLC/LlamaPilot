// My changes here...'use strict';
const { chat }                = require('./ollama');
const { getWorkspaceContext } = require('./workspace');
const readFile                = require('./tools/readFile');
const writeFile               = require('./tools/writeFile');
const runShell                = require('./tools/runShell');
const deleteFile              = require('./tools/deleteFile');
const webSearch               = require('./tools/webSearch');

const MAX_TURNS = 16;
const TOOL_RE   = /<tool_call>([\s\S]*?)<\/tool_call>/;

function buildSystem(workspace, tree, model) {
  return `You are LlamaPilot — an AI code executor. You are NOT just a text model. You MUST use tools to make real changes to files.

## Workspace
Path: ${workspace}
${tree}

## CRITICAL: How to use tools
When you need to take action (read, write, run, search), you MUST output a tool call on its own line.

**MANDATORY TOOL CALL FORMAT:**
On a separate line, write EXACTLY:
<tool_call>{"tool":"TOOL_NAME","args":{"argName":"value"}}</tool_call>

**EXAMPLES OF CORRECT OUTPUT:**

Example 1 - Reading a file:
I need to see the current code first.
<tool_call>{"tool":"readFile","args":{"path":"src/index.js"}}</tool_call>

Example 2 - Writing a file:
Now I'll create the new config file.
<tool_call>{"tool":"writeFile","args":{"path":"config.json","content":"{\\"name\\":\\"app\\"}"}}</tool_call>

Example 3 - Running a command:
Let me install dependencies.
<tool_call>{"tool":"runShell","args":{"command":"npm install"}}</tool_call>

Example 4 - Searching docs:
<tool_call>{"tool":"webSearch","args":{"query":"Node.js async await"}}</tool_call>

## Available Tools

**readFile** — Read a file to understand existing code
  MUST call before editing a file
  args: { "path": "relative/path/to/file" }
  Example: {"tool":"readFile","args":{"path":"src/main.js"}}

**writeFile** — Create or modify files (REQUIRED to apply changes)
  You MUST use writeFile to apply every change—never skip this
  Include the COMPLETE file content, no placeholders
  args: { "path": "src/app.js", "content": "full file text here" }
  Example: {"tool":"writeFile","args":{"path":"app.js","content":"console.log('hello');"}}

**runShell** — Execute shell commands (user will approve)
  Use for npm/git/build commands
  args: { "command": "npm install", "cwd": "optional/subdir" }
  Example: {"tool":"runShell","args":{"command":"npm test"}}

**deleteFile** — Permanently delete files (user will approve)
  args: { "path": "src/old.js" }
  Example: {"tool":"deleteFile","args":{"path":"unused.js"}}

**webSearch** — Search for documentation or code examples
  args: { "query": "search terms" }
  Example: {"tool":"webSearch","args":{"query":"javascript promise"}}

## RULES - MUST FOLLOW

1. **ALWAYS use tools.** Do not just explain what you would do—actually do it.

2. **When asked to write/create/modify code:**
   - First: readFile to see what exists (if file already exists)
   - Then: writeFile with the COMPLETE new content
   - Finally: Explain what changed

3. **When editing an existing file:**
   - ALWAYS readFile first to understand context
   - Write the ENTIRE file content to writeFile
   - Never say "just add these lines" without actually writing

4. **Complete file contents:**
   - writeFile must contain 100% of the file
   - Never use placeholders like "// ... rest ..."
   - Never say "keep the existing code and add..."

5. **One action per tool call:**
   - Output one <tool_call> block per message
   - Wait for result before next tool

6. **After tool execution:**
   - Summarize what the tool did
   - Explain the result
   - Ask for next steps if needed

## You are NOT just explaining—you are EXECUTING`;
}

async function runAgent({ messages, workspace, sendEvent, model }) {
  const usedModel = model || process.env.LLAMAPILOT_MODEL || 'deepseek-coder';
  const tree = await getWorkspaceContext(workspace);
  const conv = [
    { role: 'system', content: buildSystem(workspace, tree, usedModel) },
    ...messages,
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let raw;
    try {
      raw = await chat(conv, usedModel);
    } catch (err) {
      sendEvent({ type: 'error', content: `Ollama error: ${err.message}\n\nMake sure Ollama is running and the model is pulled:\n  ollama pull ${usedModel}` });
      return;
    }

    if (!raw || !raw.trim()) {
      sendEvent({ type: 'error', content: 'Model returned an empty response. Try again.' });
      return;
    }

    const match = TOOL_RE.exec(raw);

    if (!match) {
      // Check if this looks like the model is just explaining instead of executing
      const lastMsg = conv[conv.length - 1]?.content || '';
      const userAskedForAction = /\b(write|create|modify|generate|build|add|make|delete|run|execute|install|deploy|refactor|fix|change|update)\b/i.test(lastMsg);
      
      if (userAskedForAction && turn < 2) {
        // Model should have used a tool but didn't — re-prompt it
        sendEvent({ 
          type: 'agent_text', 
          content: '⚠️ You described the action but didn\'t execute it. Use the tool format shown in your instructions.\n' 
        });
        conv.push({ role: 'assistant', content: raw });
        conv.push({
          role: 'user',
          content: `You described what to do but didn't execute it. The user asked you to actually ${lastMsg.match(/\b(write|create|modify|generate|build|add|make|delete|run|execute|install|deploy|refactor|fix|change|update)\b/i)?.[0] || 'do something'}. Use the tool format: <tool_call>{"tool":"...","args":{...}}</tool_call>`,
        });
        continue;
      }

      // Final response — stream word by word to the UI
      sendEvent({ type: 'stream_start' });
      const tokens = raw.split(/(?<=\s)|(?=\s)/);
      for (const tok of tokens) {
        sendEvent({ type: 'stream_chunk', content: tok });
        await sleep(4);
      }
      sendEvent({ type: 'stream_done' });
      return;
    }

    // Show any reasoning text that appeared before the tool call tag
    const before = raw.slice(0, match.index).trim();
    if (before) {
      sendEvent({ type: 'agent_text', content: before });
    }

    // Parse tool call JSON
    let call;
    try {
      call = JSON.parse(match[1].trim());
    } catch {
      sendEvent({ type: 'error', content: `Model produced malformed tool JSON:\n${match[1]}\n\nRetrying may help.` });
      return;
    }

    if (!call.tool) {
      sendEvent({ type: 'error', content: 'Model returned a tool call with no tool name.' });
      return;
    }

    sendEvent({ type: 'tool_start', tool: call.tool, args: call.args || {} });

    let result;
    try {
      result = await dispatch(call.tool, call.args || {}, workspace, sendEvent);
    } catch (err) {
      result = `Error executing ${call.tool}: ${err.message}`;
    }

    sendEvent({ type: 'tool_done', tool: call.tool, result });

    // Feed result back and loop
    conv.push({ role: 'assistant', content: raw });
    conv.push({
      role: 'user',
      content: `<tool_result tool="${call.tool}">\n${result}\n</tool_result>\n\nContinue with the task.`,
    });
  }

  sendEvent({ type: 'error', content: `Reached the maximum of ${MAX_TURNS} steps without finishing. Try breaking the task into smaller pieces.` });
}

async function dispatch(tool, args, workspace, sendEvent) {
  switch (tool) {
    case 'readFile':
      if (!args.path) throw new Error('readFile requires a path argument');
      return readFile(args.path, workspace);

    case 'writeFile':
      if (!args.path)    throw new Error('writeFile requires a path argument');
      if (!args.content && args.content !== '') throw new Error('writeFile requires a content argument');
      return writeFile(args.path, args.content, workspace);

    case 'runShell':
      if (!args.command) throw new Error('runShell requires a command argument');
      return runShell(args.command, workspace, args.cwd, sendEvent);

    case 'deleteFile':
      if (!args.path) throw new Error('deleteFile requires a path argument');
      return deleteFile(args.path, workspace, sendEvent);

    case 'webSearch':
      if (!args.query) throw new Error('webSearch requires a query argument');
      return webSearch(args.query);

    default:
      throw new Error(`Unknown tool "${tool}". Valid tools: readFile, writeFile, runShell, deleteFile, webSearch`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { runAgent };