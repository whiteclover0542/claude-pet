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

// 시트의 어느 행이 어떤 동작인지 (preview-rows.js로 눈으로 확인한 결과).
// 지금까지 받은 시트들은 모두 이 11행 구성을 그대로 따른다.
const CLIPS = [
  { name: 'idle', row: 0, fps: 5, label: '앉아서 눈 깜빡' },
  { name: 'walk', row: 1, fps: 10, label: '옆으로 총총 걷기' },
  { name: 'run', row: 2, fps: 12, label: '달리기' },
  { name: 'wave', row: 3, fps: 5, label: '앞발 흔들기' },
  { name: 'beg', row: 4, fps: 6, label: '두 발 들고 조르기' },
  { name: 'sleep', row: 5, fps: 4, label: '서 있다가 엎드려 잠들기' },
  { name: 'happy', row: 6, fps: 8, label: '서서 신난 상태' },
  { name: 'tilt', row: 7, fps: 5, label: '앉아서 고개 갸웃' },
  { name: 'sit', row: 8, fps: 5, label: '앉아서 방긋' },
  { name: 'turn', row: 9, fps: 10, label: '제자리에서 한 바퀴' },
  { name: 'trot', row: 10, fps: 10, label: '작게 총총' }
];

// 펫 상태 → 클립
const STATES = {
  idle: 'idle',
  thinking: 'tilt',
  working: 'walk',
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
