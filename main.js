'use strict';
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;

// WSL + headless GPU workarounds
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');

// ── Parse workspace ───────────────────────────────────────────────────────────
function parseWorkspace() {
  const args = process.argv.slice(2);
  const flag = args.find((a) => a.startsWith('--workspace='));
  if (flag) return flag.replace('--workspace=', '');
  const bare = args.filter((a) => !a.startsWith('--')).pop();
  return bare || process.cwd();
}
const WORKSPACE = parseWorkspace();

// ── Window ────────────────────────────────────────────────────────────────────
let mainWindow = null;

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (!BrowserWindow.getAllWindows().length) createWindow();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1e1e',
    title: `LlamaPilot — ${path.basename(WORKSPACE)}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ── Approval flow ─────────────────────────────────────────────────────────────
const pendingApprovals = new Map();

function requestApproval(payload) {
  return new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingApprovals.set(id, resolve);
    mainWindow?.webContents.send('approval-request', { id, ...payload });
    // Auto-deny after 10 minutes
    setTimeout(() => {
      if (pendingApprovals.has(id)) {
        pendingApprovals.delete(id);
        resolve(false);
      }
    }, 600_000);
  });
}

ipcMain.on('approval-response', (_, { id, approved }) => {
  const resolve = pendingApprovals.get(id);
  if (resolve) {
    pendingApprovals.delete(id);
    resolve(approved);
  }
});

// ── IPC handlers ──────────────────────────────────────────────────────────────
const { runAgent } = require('./src/agent');
const { listDir } = require('./src/workspace');
const ollama = require('./src/ollama');

ipcMain.handle('getWorkspace', () => WORKSPACE);

ipcMain.handle('listDir', async (_, relPath = '.') =>
  listDir(relPath, WORKSPACE),
);

ipcMain.handle('readFile', async (_, relPath) => {
  const full = path.resolve(WORKSPACE, relPath);
  const wsBase = path.resolve(WORKSPACE);
  const fullNorm = path.normalize(full).toLowerCase();
  const baseNorm = path.normalize(wsBase).toLowerCase();
  if (!fullNorm.startsWith(baseNorm + path.sep) && fullNorm !== baseNorm)
    throw new Error('Path outside workspace');
  return fs.readFile(full, 'utf8');
});

ipcMain.handle('writeFile', async (_, relPath, content) => {
  const full = path.resolve(WORKSPACE, relPath);
  const wsBase = path.resolve(WORKSPACE);
  const fullNorm = path.normalize(full).toLowerCase();
  const baseNorm = path.normalize(wsBase).toLowerCase();
  if (!fullNorm.startsWith(baseNorm + path.sep) && fullNorm !== baseNorm)
    throw new Error('Path outside workspace');
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
  return true;
});

ipcMain.handle('chat', async (_, messages) => {
  function sendEvent(evt) {
    if (evt.type === 'request_approval') return requestApproval(evt);
    mainWindow?.webContents.send('agent-event', evt);
    return Promise.resolve(null);
  }
  try {
    const model = process.env.LLAMAPILOT_MODEL || 'mistral:7b';
    await runAgent({ messages, workspace: WORKSPACE, sendEvent, model });
  } catch (err) {
    mainWindow?.webContents.send('agent-event', {
      type: 'error',
      content: err.message,
    });
  }
  return true;
});
