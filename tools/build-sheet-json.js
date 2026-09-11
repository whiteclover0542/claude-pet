/**
 * analyze-sheet가 찾아낸 프레임 상자를 앱이 쓰는 sheet.json으로 바꾼다.
 *
 *   node tools/build-sheet-json.js <캐릭터ID> <표시이름> <시트파일명>
 *   예)  node tools/build-sheet-json.js mong 몽이 mong-sheet.webp
 *   → assets/characters/<캐릭터ID>.json
 *
 * 원본 webp를 자르지 않고 좌표만 기록하므로 재인코딩 품질 손실이 없다.
 * analyze-sheet.js를 먼저 그 시트에 대해 돌려서 tools/sheet-boxes.json을
 * 만들어 둬야 한다.
 */
const fs = require('fs');
const path = require('path');

const [, , charId, displayName, sheetFile] = process.argv;
if (!charId || !displayName || !sheetFile) {
  console.error('사용법: node tools/build-sheet-json.js <캐릭터ID> <표시이름> <시트파일명>');
  process.exit(1);
}

const boxes = JSON.parse(fs.readFileSync(path.join(__dirname, 'sheet-boxes.json'), 'utf-8'));

// 시트의 어느 행이 어떤 동작인지. 처음엔 자세만 보고 추측했다가 실제
// 의도(만든 사람이 알려준 것)와 다른 행이 있어서, 아래는 그걸로 확정한
// 목록이다. 지금까지 받은 시트들은 모두 이 11행 구성을 그대로 따른다.
const CLIPS = [
  { name: 'idle', row: 0, fps: 4, label: '기본 상태' },
  { name: 'walkRight', row: 1, fps: 7, label: '오른쪽으로 걷기' },
  { name: 'walkLeft', row: 2, fps: 7, label: '왼쪽으로 걷기' },
  { name: 'wave', row: 3, fps: 4, label: '인사하기' },
  { name: 'jump', row: 4, fps: 6, label: '점프 후 착지' },
  { name: 'sulky', row: 5, fps: 3, label: '시무룩한 상태' },
  { name: 'poke', row: 6, fps: 4, label: '앞발로 건드리기' },
  { name: 'working', row: 7, fps: 4, label: '작업하는 상태' },
  { name: 'ponder', row: 8, fps: 4, label: '고민하는 상태' },
  // lookRight/Left는 정지 프레임으로만 쓰여서(마우스 각도 추적) fps는 의미 없다
  { name: 'lookRight', row: 9, fps: 10, label: '마우스 커서 바라보기 (오른쪽)' },
  { name: 'lookLeft', row: 10, fps: 10, label: '마우스 커서 바라보기 (왼쪽)' }
];

// 펫 상태 → 클립
const STATES = {
  idle: 'idle',
  thinking: 'ponder',
  working: 'working',
  notify: 'wave'
};

const clips = {};
CLIPS.forEach(({ name, row, fps, label }) => {
  const r = boxes.rows[row];
  if (!r) throw new Error(`시트에 행 ${row}이 없습니다`);
  clips[name] = {
    label,
    fps,
    // 프레임마다 크기가 달라서, 행 전체를 감싸는 칸 크기를 함께 준다.
    // 렌더러는 이 칸 안에서 각 프레임을 "아래-가운데" 기준으로 정렬한다.
    cellW: r.cellW,
    cellH: r.cellH,
    frames: r.boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }))
  };
});

const out = {
  name: displayName,
  image: sheetFile,
  sheetWidth: boxes.width,
  sheetHeight: boxes.height,
  // 프레임은 발이 바닥에 닿도록 아래-가운데 기준으로 정렬한다
  anchor: 'bottom-center',
  states: STATES,
  clips
};

const dest = path.join(__dirname, '..', 'assets', 'characters', `${charId}.json`);
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(`${dest}`);
Object.entries(clips).forEach(([name, c]) => {
  console.log(`  ${name.padEnd(8)} ${String(c.frames.length).padStart(2)}컷  ${c.cellW}x${c.cellH}  ${c.label}`);
});
