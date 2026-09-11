/**
 * find-holes.js가 "구멍"이라고 지목한 좌표 주변 7x7 픽셀의 실제 RGBA 값을
 * 찍어본다. 확대 이미지로는 안 보이는 작은 투명 구멍(알파=0)을 직접
 * 눈으로 확인하고 싶을 때 쓴다.
 *
 *   npx electron tools/probe-pixel.js <x> <y>
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const x = process.argv[2] || '63';
const y = process.argv[3] || '77';

ipcMain.on('result', (_e, payload) => {
  console.log(payload);
  app.exit(0);
});

app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  win.loadFile(path.join(__dirname, 'probe-pixel.html'), { query: { x, y } });
});
