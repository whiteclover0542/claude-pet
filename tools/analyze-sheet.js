/**
 * 캐릭터 시트에서 프레임 격자를 자동으로 찾아낸다 (개발용, Electron으로 실행).
 *
 *   npx electron tools/analyze-sheet.js
 *
 * 시트는 행마다 프레임 수와 크기가 제각각이라 눈대중 대신 알파 채널을 보고
 * "잉크가 있는 띠 → 그 안의 덩어리"로 잘라낸다. 결과는 stdout에 JSON으로 찍고
 * tools/sheet-boxes.json 에도 저장한다.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

ipcMain.on('result', (_e, payload) => {
  if (payload.error) {
    console.error('분석 실패:', payload.error);
    app.exit(1);
    return;
  }
  fs.writeFileSync(path.join(__dirname, 'sheet-boxes.json'), JSON.stringify(payload, null, 2));
  console.log(`시트 ${payload.width}x${payload.height}, 행 ${payload.rows.length}개`);
  payload.rows.forEach((row, i) => {
    const b = row.boxes[0];
    console.log(
      `  행 ${String(i).padStart(2)}: 프레임 ${String(row.boxes.length).padStart(2)}개  ` +
      `셀 ${row.cellW}x${row.cellH}  y=${row.y}~${row.y + row.h}  첫칸 x=${b.x} w=${b.w} h=${b.h}`
    );
  });
  app.exit(0);
});

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.loadFile(path.join(__dirname, 'analyze-sheet.html'));
});
