/**
 * 시트 가장자리에 남은 마젠타 크로마키 배경 잔여물(주로 발밑)을 지운다.
 * R,B가 G보다 훨씬 높은 픽셀을 찾아 4방향 최근접 "깨끗한" 색으로 채우고,
 * 못 찾으면 투명 처리한다.
 *
 *   npx electron tools/fix-magenta.js
 *   → fix-magenta.html의 SHEET(현재 최종본)를 직접 덮어쓰지 않고
 *     mong-sheet-nomagenta.png로 저장한다. 확인 후 이름을 바꿔 쓴다.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const OUT = path.join(__dirname, '..', 'assets', 'characters', 'mong-sheet-nomagenta.png');

ipcMain.on('result', (_e, payload) => {
  if (payload && payload.error) {
    console.error('실패:', payload.error);
    app.exit(1);
    return;
  }
  fs.writeFileSync(OUT, Buffer.from(payload.png.split(',')[1], 'base64'));
  console.log(`마젠타 픽셀 ${payload.count}개를 지웠습니다 → ${OUT}`);
  app.exit(0);
});

app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  win.loadFile(path.join(__dirname, 'fix-magenta.html'));
});
