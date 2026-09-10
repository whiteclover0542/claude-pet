const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudePet', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (partial) => ipcRenderer.invoke('set-config', partial),
  getActiveSession: () => ipcRenderer.invoke('get-active-session'),
  cycleSession: () => ipcRenderer.invoke('cycle-session'),
  setupHooks: () => ipcRenderer.invoke('setup-hooks'),

  // 투명한 영역은 클릭이 뒤쪽 창으로 통과하도록 토글한다
  setInteractive: (on) => ipcRenderer.send('set-interactive', on),
  dragWindowBy: (dx, dy) => ipcRenderer.send('drag-window-by', { dx, dy }),
  saveWindowPosition: () => ipcRenderer.send('save-window-position'),

  onConfigUpdated: (cb) => ipcRenderer.on('config-updated', (_e, cfg) => cb(cfg)),
  onSessionUpdated: (cb) => ipcRenderer.on('session-updated', (_e, payload) => cb(payload)),
  onSetupResult: (cb) => ipcRenderer.on('setup-result', (_e, result) => cb(result))
});
