/**
 * 시트의 특정 행 하나만 크게 확대해서 본다 (개발용, Electron으로 실행).
 *   npx electron tools/zoom-row.js <row> [out.png]
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const row = Number(process.argv[2] ?? 4);
const outPath = process.argv[3] || path.join(process.env.TEMP || __dirname, `mong-row${row}.png`);

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

ipcMain.on('png', (_e, dataUrl) => {
  if (!dataUrl || dataUrl.startsWith('ERR')) {
    console.error(dataUrl || '실패');
    app.exit(1);
    return;
  }
  fs.writeFileSync(outPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(outPath);
  app.exit(0);
});

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.loadFile(path.join(__dirname, 'zoom-row.html'), { query: { row: String(row) } });
});
