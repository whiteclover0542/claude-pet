/**
 * 시트 실루엣 안쪽에 뚫린 구멍(눈·코 등이 배경 제거 때 투명 처리된 것)을
 * 주변 색으로 메운다. find-holes.js로 문제를 확인한 뒤에만 쓰는 비상 도구.
 *
 *   npx electron tools/fix-holes.js
 *
 * 지금은 몽이 시트가 깨끗해서(원본 재교체로 해결) 안 쓰고 있다. 다음에
 * 다른 캐릭터에서 같은 문제(find-holes.js가 눈·코 위치에 구멍을 찾음)가
 * 생기면, 이 파일과 fix-holes.html의 SHEET/OUT 경로를 그 캐릭터의
 * 원본/최종본 파일명으로 바꿔서 재사용한다. 매번 "깨끗한 원본"에서 다시
 * 계산해서 최종본을 덮어쓰는 구조라, 파라미터를 조정하며 여러 번 돌려도
 * 결과가 누적되어 이상해지지 않는다.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const OUT = path.join(__dirname, '..', 'assets', 'characters', 'mong-sheet-fixed.png');

ipcMain.on('result', (_e, payload) => {
  if (payload && payload.error) {
    console.error('실패:', payload.error);
    app.exit(1);
    return;
  }
  fs.writeFileSync(OUT, Buffer.from(payload.png.split(',')[1], 'base64'));
  console.log(`구멍 ${payload.holeCount}개를 메웠습니다 → ${OUT}`);
  app.exit(0);
});

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.loadFile(path.join(__dirname, 'fix-holes.html'));
});
