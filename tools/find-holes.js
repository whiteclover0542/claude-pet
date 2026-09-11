/**
 * 시트의 각 프레임 실루엣 안쪽에 알파가 뚫린 "구멍"이 있는지 찾는다.
 * 눈·코처럼 진한 색 픽셀이 배경 제거 과정에서 투명 처리된 경우를 잡아낸다.
 *
 *   npx electron tools/find-holes.js
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

ipcMain.on('result', (_e, payload) => {
  if (payload && payload.error) {
    console.error('실패:', payload.error);
    app.exit(1);
    return;
  }
  const { summary, markedPng } = payload;
  if (!summary.length) {
    console.log('구멍 없음 — 모든 프레임이 깨끗합니다.');
  } else {
    console.log(`구멍이 있는 프레임 ${summary.length}개:`);
    summary
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .forEach((h) => {
        console.log(`  행 ${h.row} · 프레임 ${h.col}  구멍 픽셀 ${h.count}개  (예: x=${h.sample.x}, y=${h.sample.y})`);
      });
  }
  const outPath = path.join(os.tmpdir(), 'mong-holes-marked.png');
  fs.writeFileSync(outPath, Buffer.from(markedPng.split(',')[1], 'base64'));
  console.log(`시각화: ${outPath}`);
  app.exit(0);
});

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.loadFile(path.join(__dirname, 'find-holes.html'));
});
