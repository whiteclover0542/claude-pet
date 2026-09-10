/**
 * 시트의 행별 프레임을 번호와 함께 한 장으로 뽑는다 (개발용, Electron으로 실행).
 *
 *   npx electron tools/preview-rows.js [out.png]
 *
 * analyze-sheet가 찾아낸 sheet-boxes.json을 그대로 써서, 어떤 행이 어떤 동작인지
 * 눈으로 확인하고 상태(idle/thinking/working/notify)에 매핑하는 데 쓴다.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const outPath = process.argv[2] || path.join(process.env.TEMP || __dirname, 'sheet-rows.png');

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
  win.loadFile(path.join(__dirname, 'preview-rows.html'));
});
