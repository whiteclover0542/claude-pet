/**
 * 시트 파일(inspect-sheet.html의 SHEET 상수)의 실제 디코드된 해상도를
 * 찍어본다. webp/png 헤더를 손으로 파싱하지 않고 빠르게 확인할 때 쓴다.
 *
 *   npx electron tools/inspect-sheet.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

ipcMain.on('result', (_e, payload) => {
  console.log(JSON.stringify(payload));
  app.exit(payload.error ? 1 : 0);
});

app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  win.loadFile(path.join(__dirname, 'inspect-sheet.html'));
});
