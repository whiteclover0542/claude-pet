/**
 * mong.json에 정의된 클립 11개의 대표 프레임을 이름·설명과 함께 한 장에
 * 모아 보여준다 (개발용). 어떤 클립 이름이 실제로 어떤 사진인지 헷갈릴 때
 * 확인 용도.
 *
 *   npx electron tools/preview-clips.js [out.png]
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const OUT = process.argv[2] || path.join(process.env.TEMP || __dirname, 'mong-clips.png');

ipcMain.on('result', (_e, dataUrl) => {
  if (!dataUrl || dataUrl.startsWith('ERR')) {
    console.error(dataUrl || '실패');
    app.exit(1);
    return;
  }
  fs.writeFileSync(OUT, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(OUT);
  app.exit(0);
});

app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  win.loadFile(path.join(__dirname, 'preview-clips.html'));
});
