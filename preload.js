const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudePet', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getStatus: () => ipcRenderer.invoke('get-status'),
  setConfig: (partial) => ipcRenderer.invoke('set-config', partial),
  setupHooks: () => ipcRenderer.invoke('setup-hooks'),
  dragWindow: (x, y) => ipcRenderer.send('drag-window', { x, y }),
  onConfigUpdated: (cb) => ipcRenderer.on('config-updated', (_e, cfg) => cb(cfg)),
  onStatusUpdated: (cb) => ipcRenderer.on('status-updated', (_e, status) => cb(status)),
  onSetupResult: (cb) => ipcRenderer.on('setup-result', (_e, result) => cb(result))
});
