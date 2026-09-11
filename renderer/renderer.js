const petEl = document.getElementById('pet');
const canvas = document.getElementById('pet-canvas');
const bubble = document.getElementById('bubble');
const titleEl = document.getElementById('bubble-title');
const sourceEl = document.getElementById('bubble-source');
const stateEl = document.getElementById('bubble-state');
const bodyEl = document.getElementById('bubble-body');
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

// 답변이 도착하면 말풍선 본문을 이 시간만큼 펼쳐 둔다
const REPLY_VISIBLE_MS = 20000;
// 대기 상태가 이만큼 지나면 말풍선을 접는다
const IDLE_HIDE_MS = 6000;
// 펫을 눌렀다 뗄 때, 이 거리 안에서 멈추면 드래그가 아니라 클릭으로 본다
const CLICK_DRAG_THRESHOLD = 6;
const SCALE_MIN = 0.5;
const SCALE_MAX = 2.0;
const SCALE_STEP = 0.25;

let sprite = null;
let hideTimer = null;
let replyTimer = null;
let lastReplyAt = null;
let pinned = false; // 마우스를 올리고 있으면 말풍선을 접지 않는다
let hasSession = false; // 돌아가는 세션이 있어야만 마우스오버로 말풍선을 연다
let currentState = 'idle';
let loadedCharacter = null;
let currentConfig = null;

function setBubbleVisible(visible) {
  bubble.classList.toggle('hidden', !visible);
}

function showReply(text) {
  bodyEl.textContent = text;
  bodyEl.classList.remove('hidden');
  clearTimeout(replyTimer);
  replyTimer = setTimeout(() => {
    if (!pinned) bodyEl.classList.add('hidden');
  }, REPLY_VISIBLE_MS);
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

  if (!session) {
    // 돌아가는 세션이 없으면 조용히 대기 (마우스를 올려도 말풍선을 열지 않는다)
    hasSession = false;
    currentState = 'idle';
    sprite && sprite.setState('idle');
    petEl.classList.remove('notify');
    setBubbleVisible(false);
    dotsEl.classList.add('hidden');
    return;
  }

  hasSession = true;
  currentState = session.state;
  sprite && sprite.setState(session.state);
  petEl.classList.toggle('notify', session.state === 'notify');

  titleEl.textContent = bubbleTitle(session);
  sourceEl.textContent = SOURCE_LABEL[session.entrypoint] || '';
  stateEl.textContent = stateLine(session);

  // 새 답변이 도착했을 때만 본문을 펼친다
  if (session.reply && session.replyAt && session.replyAt !== lastReplyAt) {
    lastReplyAt = session.replyAt;
    showReply(session.reply);
  }

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
});
document.addEventListener('mouseleave', () => updateInteractive(null));

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

dotsEl.addEventListener('click', () => window.claudePet.cycleSession());

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
    sprite.setState(currentState);
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
