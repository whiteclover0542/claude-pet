const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudePet', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (partial) => ipcRenderer.invoke('set-config', partial),
  getActiveSession: () => ipcRenderer.invoke('get-active-session'),
  cycleSession: () => ipcRenderer.invoke('cycle-session'),
  setupHooks: () => ipcRenderer.invoke('setup-hooks'),
  quitApp: () => ipcRenderer.send('quit-app'),

  // 투명한 영역은 클릭이 뒤쪽 창으로 통과하도록 토글한다
  setInteractive: (on) => ipcRenderer.send('set-interactive', on),
  dragWindowBy: (dx, dy, offset) => ipcRenderer.send('drag-window-by', { dx, dy, offset }),
  saveWindowPosition: () => ipcRenderer.send('save-window-position'),

  // 말풍선을 누르면 그 대화가 돌아가는 화면(VSCode/터미널)으로 이동을 시도한다
  focusSessionWindow: (session) => ipcRenderer.send('focus-session-window', session),
  // 답변 도착 후 그 화면이 포커스될 때까지 지켜봐 달라고 요청한다
  watchForFocus: (session) => ipcRenderer.send('watch-for-focus', session),

  onConfigUpdated: (cb) => ipcRenderer.on('config-updated', (_e, cfg) => cb(cfg)),
  onSessionUpdated: (cb) => ipcRenderer.on('session-updated', (_e, payload) => cb(payload)),
  onSetupResult: (cb) => ipcRenderer.on('setup-result', (_e, result) => cb(result)),
  onSourceWindowFocused: (cb) => ipcRenderer.on('source-window-focused', (_e, sessionId) => cb(sessionId))
});
