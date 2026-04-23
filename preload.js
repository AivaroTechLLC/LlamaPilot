'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('llama', {
  getWorkspace: () => ipcRenderer.invoke('getWorkspace'),
  listDir: (p) => ipcRenderer.invoke('listDir', p),
  readFile: (p) => ipcRenderer.invoke('readFile', p),
  writeFile: (p, c) => ipcRenderer.invoke('writeFile', p, c),
  chat: (msgs) => ipcRenderer.invoke('chat', msgs),

  onAgentEvent: (cb) => ipcRenderer.on('agent-event', (_, e) => cb(e)),
  onApprovalRequest: (cb) =>
    ipcRenderer.on('approval-request', (_, d) => cb(d)),
  sendApproval: (id, approved) =>
    ipcRenderer.send('approval-response', { id, approved }),
});
