const petEl = document.getElementById('pet');
const canvas = document.getElementById('pet-canvas');
const bubble = document.getElementById('bubble');
const titleEl = document.getElementById('bubble-title');
const sourceEl = document.getElementById('bubble-source');
const stateEl = document.getElementById('bubble-state');
const dotsEl = document.getElementById('session-dots');
const gearEl = document.getElementById('gear-btn');
const panelEl = document.getElementById('settings-panel');
const scaleValueEl = document.getElementById('scale-value');
const scaleDownBtn = document.getElementById('scale-down');
const scaleUpBtn = document.getElementById('scale-up');
const characterListEl = document.getElementById('character-list');
const setupHooksBtn = document.getElementById('setup-hooks-btn');
const quitBtn = document.getElementById('quit-btn');

const STATE_LABEL = {
  idle: '대기 중',
  thinking: '생각 중',
  working: '작업 중',
  notify: '확인해 주세요!'
};

// 어디서 돌고 있는 세션인지 (트랜스크립트의 entrypoint 값)
const SOURCE_LABEL = {
  'claude-vscode': 'VSCode',
  cli: '터미널',
  sdk: 'SDK'
};

// 대기 상태가 이만큼 지나면 말풍선을 접는다
const IDLE_HIDE_MS = 6000;
// 펫을 눌렀다 뗄 때, 이 거리 안에서 멈추면 드래그가 아니라 클릭으로 본다
const CLICK_DRAG_THRESHOLD = 6;
const SCALE_MIN = 0.5;
const SCALE_MAX = 2.0;
const SCALE_STEP = 0.25;

// --- 클립(애니메이션) 전환 타이밍 ------------------------------------------
// 시트에 있는 11개 동작을 상태·이벤트·마우스 위치에 따라 자연스럽게
// 갈아탄다. (clips: idle, walkRight/Left, wave, jump, sulky, poke,
// working, ponder, lookRight/Left)
//
// 우선순위 (위에 있을수록 우선, 끝나면 자동으로 아래 단계로 돌아간다)
//   1. 드래그 중              → 드래그 방향으로 걷기 (walkRight/Left)
//   2. 답변 도착               → jump
//   3. 마우스가 펫 가까이(주변) 있음 → look (애니메이션이 아니라 각도별 정지
//      프레임). 마우스가 펫 위에 정확히 올라오면 오히려 정면(기본 모션)
//   4. notify/thinking/working/idle → wave/ponder/working/idle
//      idle이 한동안 이어지면 poke를 한 번씩 짧게 끼워 넣는다
//      세션이 아예 없으면(할 게 없으면) sulky
const JUMP_DURATION_MS = 3500; // 답변이 막 도착했을 때 반기는 시간
const POKE_MIN_GAP_MS = 20000; // idle 상태에서 다음 poke까지 최소 대기
const POKE_MAX_GAP_MS = 40000; // idle 상태에서 다음 poke까지 최대 대기
const POKE_PLAY_MS = 1500; // poke를 보여주는 시간
const CLIP_TICK_MS = 500; // 시간 기반 전환(jump 종료 등)을 재확인하는 주기

let sprite = null;
let hideTimer = null;
let lastReplyAt = null;
let pinned = false; // 마우스를 올리고 있으면 말풍선을 접지 않는다
let hasSession = false; // 돌아가는 세션이 있어야만 마우스오버로 말풍선을 연다
let loadedCharacter = null;
let currentConfig = null;

// --- 클립 상태 머신 --------------------------------------------------------
let lastSession = null; // 가장 최근에 받은 session 객체 (없으면 null)
let lastClipState = null; // idle/thinking/working/notify/none 중 무엇으로 마지막에 갈아탔는지
let jumpUntil = 0; // 이 시각까지는 jump를 최우선으로 재생 (답변 도착)
let dragDirection = null; // 드래그 중일 때만 'walkRight'|'walkLeft'
let hovering = false; // 마우스가 펫 위에 있는 동안 각도별 정지 프레임을 보여준다
let pokeAt = 0; // 다음 poke를 재생할 예정 시각 (idle 상태에서만 의미 있음)

function scheduleNextPoke(now) {
  pokeAt = now + POKE_MIN_GAP_MS + Math.random() * (POKE_MAX_GAP_MS - POKE_MIN_GAP_MS);
}

/** session.state와 경과 시간을 보고 실제로 재생할 클립을 정한다 */
function updateClip() {
  if (!sprite) return;
  const now = Date.now();
  // 세션이 아예 없으면 idle이 아니라 'none'으로 구분해야 sulky로 갈 수 있다
  const state = lastSession ? lastSession.state : 'none';

  if (state !== lastClipState) {
    lastClipState = state;
    if (state === 'idle') scheduleNextPoke(now);
  }

  // 1순위: 펫을 드래그해서 옮기는 중이면 그 방향으로 걷는다
  if (dragDirection) return sprite.setClip(dragDirection);
  // 2순위: 답변이 막 도착했으면 반긴다
  if (now < jumpUntil) return sprite.setClip('jump');
  // 3순위: 마우스가 펫 위에 있으면 (정지 프레임은 mousemove 핸들러가 직접
  // sprite.setStaticFrame으로 그리므로, 여기서는 다른 클립으로 덮어쓰지 않는다)
  if (hovering) return;

  if (state === 'notify') return sprite.setClip('wave');
  if (state === 'thinking') return sprite.setClip('ponder');
  if (state === 'working') return sprite.setClip('working');
  if (state === 'idle') {
    if (now >= pokeAt) {
      if (now < pokeAt + POKE_PLAY_MS) return sprite.setClip('poke');
      scheduleNextPoke(now); // poke가 끝났으면 다음 번을 다시 예약
    }
    return sprite.setClip('idle');
  }
  // 세션이 아예 없어서 할 일이 없을 때
  sprite.setClip('sulky');
}

// setInterval은 포커스 없는 이 창에서 스로틀링되어 거의 안 돌기 때문에,
// 이미 정상 동작이 확인된 requestAnimationFrame 루프 안에서 주기를 잰다.
let lastClipTick = 0;
function clipTickLoop(now) {
  if (now - lastClipTick >= CLIP_TICK_MS) {
    lastClipTick = now;
    updateClip();
  }
  requestAnimationFrame(clipTickLoop);
}
requestAnimationFrame(clipTickLoop);

function setBubbleVisible(visible) {
  bubble.classList.toggle('hidden', !visible);
}

function truncate(text, max) {
  if (!text) return '';
  const t = String(text).trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * 말풍선 제목. Claude가 붙인 채팅 제목(ai-title)이 아직 없으면
 * "새 채팅" 같은 빈 문구 대신, 지금 하고 있는 일을 간략히 보여준다:
 * 방금 도착한 답변 → 없으면 지금 처리 중인 질문 → 그것도 없으면 준비 중 문구.
 */
function bubbleTitle(session) {
  if (session.title) return session.title;
  if (session.reply) return truncate(session.reply, 28);
  if (session.prompt) return truncate(session.prompt, 28);
  return '대화 준비 중…';
}

/** 상태별 두 번째 줄 문구 */
function stateLine(session) {
  const base = STATE_LABEL[session.state] || '';
  if (session.state === 'working' && session.tool) return `${base} · ${session.tool}`;
  // 생각 중일 땐 무엇을 물어봤는지 보여준다 (제목에 아직 답변/제목이 없을 때는 중복이니 생략)
  if (session.state === 'thinking' && session.prompt && session.title) return truncate(session.prompt, 40);
  return base;
}

function applySession(payload) {
  const session = payload.session;
  lastSession = session;

  if (!session) {
    // 돌아가는 세션이 없으면 조용히 대기 (마우스를 올려도 말풍선을 열지 않는다)
    hasSession = false;
    petEl.classList.remove('notify');
    setBubbleVisible(false);
    dotsEl.classList.add('hidden');
    updateClip();
    return;
  }

  hasSession = true;
  petEl.classList.toggle('notify', session.state === 'notify');

  titleEl.textContent = bubbleTitle(session);
  sourceEl.textContent = SOURCE_LABEL[session.entrypoint] || '';
  stateEl.textContent = stateLine(session);

  // 새 답변이 도착하면 펫이 잠깐 반긴다 (말풍선 제목에는 이미 요약이 뜬다)
  if (session.reply && session.replyAt && session.replyAt !== lastReplyAt) {
    lastReplyAt = session.replyAt;
    jumpUntil = Date.now() + JUMP_DURATION_MS;
  }

  updateClip();

  // 여러 세션이 돌면 점으로 표시 (클릭하면 전환)
  if (payload.count > 1) {
    dotsEl.innerHTML = '';
    for (let i = 0; i < payload.count; i++) {
      const dot = document.createElement('span');
      if (i === payload.index) dot.classList.add('active');
      dotsEl.appendChild(dot);
    }
    dotsEl.classList.remove('hidden');
  } else {
    dotsEl.classList.add('hidden');
  }

  setBubbleVisible(true);
  clearTimeout(hideTimer);
  if (session.state === 'idle' && !pinned) {
    hideTimer = setTimeout(() => {
      if (!pinned) setBubbleVisible(false);
    }, IDLE_HIDE_MS);
  }
}

// --- 마우스가 실제 요소 위에 있을 때만 창이 클릭을 받도록 ------------------
// 투명한 부분은 통과시켜야 뒤쪽 창을 정상적으로 클릭할 수 있다.
// 단, 톱니바퀴나 설정 패널이 열려 있는 동안은 "바깥을 클릭하면 닫기"가
// 되도록 창 전체를 interactive하게 유지한다.
let interactive = null;
let gearOpen = false;
let panelOpen = false;

function updateInteractive(el) {
  const want = gearOpen || panelOpen || !!(el && el.closest('[data-hit]'));
  if (want === interactive) return;
  interactive = want;
  window.claudePet.setInteractive(want);
}

document.addEventListener('mousemove', (e) => {
  updateInteractive(document.elementFromPoint(e.clientX, e.clientY));
  updateHover(e);
});
document.addEventListener('mouseleave', () => {
  updateInteractive(null);
  if (hovering) {
    hovering = false;
    updateClip();
  }
});

bubble.addEventListener('mouseenter', () => {
  pinned = true;
  clearTimeout(hideTimer);
});
bubble.addEventListener('mouseleave', () => {
  pinned = false;
});

petEl.addEventListener('mouseenter', () => {
  pinned = true;
  clearTimeout(hideTimer);
  if (hasSession) setBubbleVisible(true);
});
petEl.addEventListener('mouseleave', () => {
  pinned = false;
});

// --- 마우스 각도를 따라가는 시선 -------------------------------------------
// 마우스가 펫 "위"에 정확히 있으면 오히려 정면(기본 모션)을 보여주고,
// 펫 가장자리에서 이만큼 떨어진 "주변"에 있을 때만 그쪽을 바라본다 —
// 사람이 다가오면 쳐다보고, 만지고 있을 땐 그냥 얌전히 있는 느낌.
const HOVER_MARGIN_PX = 26;

// lookRight(row9)는 0°~157.5°, lookLeft(row10)는 180°~337.5°를 22.5° 간격
// 8프레임씩 담고 있다 (합쳐서 16방향 전체 원). "동작을 재생"하는 게 아니라
// 지금 마우스가 있는 각도의 정지 프레임 하나를 바로 보여준다.
const LOOK_FRAMES = [
  ...Array.from({ length: 8 }, (_, i) => ({ clip: 'lookRight', frame: i, angle: i * 22.5 })),
  ...Array.from({ length: 8 }, (_, i) => ({ clip: 'lookLeft', frame: i, angle: 180 + i * 22.5 }))
];

/** 점(x,y)에서 사각형 가장자리까지의 최단 거리. 사각형 안이면 0. */
function distanceToRect(x, y, rect) {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

function updateHover(e) {
  const rect = petEl.getBoundingClientRect();
  const dist = distanceToRect(e.clientX, e.clientY, rect);
  // dist === 0: 마우스가 펫 몸통 위 → 쳐다보지 않고 정면 유지
  const near = dist > 0 && dist <= HOVER_MARGIN_PX;

  if (near) {
    hovering = true;
    updateLookFrame(e, rect);
  } else if (hovering) {
    hovering = false;
    updateClip();
  }
}

function updateLookFrame(e, rect) {
  if (!sprite) return;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let angle = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI; // -180~180, 0°=오른쪽
  if (angle < 0) angle += 360; // 0~360

  let best = LOOK_FRAMES[0];
  let bestDiff = 360;
  for (const f of LOOK_FRAMES) {
    const diff = Math.min(Math.abs(angle - f.angle), 360 - Math.abs(angle - f.angle));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = f;
    }
  }
  sprite.setStaticFrame(best.clip, best.frame);
}

dotsEl.addEventListener('click', () => {
  window.claudePet.cycleSession();
});

// --- 톱니바퀴 → 설정 패널: 2단계로 연다 -----------------------------------
// 펫을 클릭하면 톱니바퀴만 나타나고, 그걸 눌러야 실제 설정 패널이 열린다.
// 실수로 펫을 눌렀을 때 바로 패널이 펼쳐지지 않도록 하기 위함.
function setGearVisible(visible) {
  gearOpen = visible;
  gearEl.classList.toggle('hidden', !visible);
  if (!visible) setPanelVisible(false);
  else updateInteractive(petEl);
}

function setPanelVisible(visible) {
  panelOpen = visible;
  panelEl.classList.toggle('hidden', !visible);
  // 열리는 순간 창 전체를 interactive하게 만들어야 바깥(투명한 부분)을
  // 클릭했을 때 이 창이 그 클릭을 받아서 패널을 닫을 수 있다.
  if (visible) updateInteractive(petEl);
}

gearEl.addEventListener('mousedown', (e) => e.stopPropagation());
gearEl.addEventListener('click', (e) => {
  e.stopPropagation();
  setPanelVisible(panelEl.classList.contains('hidden'));
});

document.addEventListener('mousedown', (e) => {
  if (!gearOpen && !panelOpen) return;
  if (e.target.closest('#pet')) return; // 펫(톱니바퀴 포함)은 각자 처리
  setGearVisible(false);
});

function renderScale(scale) {
  scaleValueEl.textContent = `${Math.round(scale * 100)}%`;
}

function renderCharacterList(cfg) {
  characterListEl.innerHTML = '';
  (cfg.characters || []).forEach(({ id, name }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = name;
    btn.classList.toggle('active', id === cfg.character);
    btn.addEventListener('click', () => window.claudePet.setConfig({ character: id }));
    characterListEl.appendChild(btn);
  });
}

scaleDownBtn.addEventListener('click', () => {
  if (!currentConfig) return;
  const next = Math.max(SCALE_MIN, +(currentConfig.scale - SCALE_STEP).toFixed(2));
  window.claudePet.setConfig({ scale: next });
});
scaleUpBtn.addEventListener('click', () => {
  if (!currentConfig) return;
  const next = Math.min(SCALE_MAX, +(currentConfig.scale + SCALE_STEP).toFixed(2));
  window.claudePet.setConfig({ scale: next });
});

// 트레이 아이콘이 안 보이는 환경(원격 데스크톱 등)도 있어서, 트레이에만
// 있던 핵심 기능(연동 설정·종료)을 설정 패널에도 넣어 둔다.
setupHooksBtn.addEventListener('click', () => window.claudePet.setupHooks());
quitBtn.addEventListener('click', () => window.claudePet.quitApp());

// --- 펫을 끌어서 위치 옮기기 (일정 거리 이상 움직여야 드래그로 본다) -------
// 창 자체는 말풍선·설정 패널까지 담을 수 있게 넉넉하게 잡혀 있어서, 창
// 경계를 기준으로 화면 밖 이탈을 막으면 펫이 코너 근처에도 못 가고 막혀버린다.
// 그래서 펫이 창 안에서 실제로 차지하는 위치(여백)를 재서 메인에 같이 넘기고,
// 메인은 "펫이 보이는 영역"만 화면 안에 있도록 clamp한다.
function petOffset() {
  const rect = petEl.getBoundingClientRect();
  return {
    top: rect.top,
    left: rect.left,
    right: window.innerWidth - rect.right,
    bottom: window.innerHeight - rect.bottom
  };
}

let drag = null;
petEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  drag = { startX: e.screenX, startY: e.screenY, moved: false, offset: petOffset() };
});
window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = e.screenX - drag.startX;
  const dy = e.screenY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD) return;
  if (!drag.moved) {
    drag.moved = true;
    petEl.classList.add('dragging');
  }
  window.claudePet.dragWindowBy(dx, dy, drag.offset);
  // 끌려가는 방향으로 걷는 모션을 보여준다 (좌우로 안 움직이면 직전 방향 유지)
  if (dx !== 0) {
    dragDirection = dx > 0 ? 'walkRight' : 'walkLeft';
    updateClip();
  }
  drag.startX = e.screenX;
  drag.startY = e.screenY;
});
window.addEventListener('mouseup', () => {
  if (!drag) return;
  const wasDrag = drag.moved;
  drag = null;
  petEl.classList.remove('dragging');
  if (wasDrag) {
    window.claudePet.saveWindowPosition();
    dragDirection = null;
    updateClip();
  } else {
    // 이동 없이 눌렀다 뗐으면 클릭 — 톱니바퀴를 보이거나 숨긴다
    setGearVisible(gearEl.classList.contains('hidden'));
  }
});

// --- 초기화 ---------------------------------------------------------------
/** 시트를 갈아끼운다. 실패하면 말풍선에 이유를 띄워 조용히 사라지지 않게 한다. */
async function loadCharacter(name, height) {
  try {
    const next = await window.loadSprite(canvas, `../assets/characters/${name}.json`);
    if (sprite) sprite.stop();
    sprite = next;
    loadedCharacter = name;
    sprite.setDisplayHeight(height);
    updateClip();
    sprite.start();
  } catch (e) {
    titleEl.textContent = '캐릭터를 불러오지 못했습니다';
    stateEl.textContent = `${name}.json — ${e.message || e}`;
    setBubbleVisible(true);
  }
}

function applyConfig(cfg) {
  currentConfig = cfg;
  renderScale(cfg.scale);
  renderCharacterList(cfg);
}

async function init() {
  const cfg = await window.claudePet.getConfig();
  applyConfig(cfg);
  await loadCharacter(cfg.character, cfg.petHeight);
  applySession(await window.claudePet.getActiveSession());
}

window.claudePet.onConfigUpdated(async (cfg) => {
  applyConfig(cfg);
  if (cfg.character !== loadedCharacter) {
    await loadCharacter(cfg.character, cfg.petHeight);
    return;
  }
  sprite && sprite.setDisplayHeight(cfg.petHeight);
});

window.claudePet.onSessionUpdated(applySession);

window.claudePet.onSetupResult((result) => {
  titleEl.textContent = result.ok ? 'Claude Code 연동 완료' : '연동 실패';
  stateEl.textContent = result.ok ? result.path : String(result.error || '');
  setBubbleVisible(true);
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => setBubbleVisible(false), 4000);
});

init();
