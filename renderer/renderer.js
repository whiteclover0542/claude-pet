const petRoot = document.getElementById('pet-root');
const svgSlot = document.getElementById('pet-svg-slot');
const label = document.getElementById('label');

const STATE_LABEL = {
  idle: '대기 중',
  thinking: '생각하는 중…',
  working: '작업 중…',
  notify: '확인해 주세요!'
};

let labelTimer = null;

function applyCharacter(name) {
  const build = window.PET_CHARACTERS[name] || window.PET_CHARACTERS.robot;
  svgSlot.innerHTML = build();
}

function applyColor(hex) {
  document.documentElement.style.setProperty('--pet-color', hex);
}

function applyState(state) {
  petRoot.classList.remove('state-idle', 'state-thinking', 'state-working', 'state-notify');
  petRoot.classList.add(`state-${state}`);

  label.textContent = STATE_LABEL[state] || '';
  label.classList.add('visible');
  clearTimeout(labelTimer);
  // idle 상태 라벨은 잠시 후 자동으로 숨김 (평소엔 조용히 대기)
  if (state === 'idle') {
    labelTimer = setTimeout(() => label.classList.remove('visible'), 1800);
  }
}

async function init() {
  const cfg = await window.claudePet.getConfig();
  const status = await window.claudePet.getStatus();

  petRoot.className = `state-${status.state} character-${cfg.character}`;
  applyCharacter(cfg.character);
  applyColor(cfg.color);
  applyState(status.state);
}

window.claudePet.onConfigUpdated((cfg) => {
  applyCharacter(cfg.character);
  applyColor(cfg.color);
});

window.claudePet.onStatusUpdated((status) => {
  applyState(status.state);
});

window.claudePet.onSetupResult((result) => {
  label.textContent = result.ok ? 'Claude Code 연동 완료 ✓' : '연동 실패';
  label.classList.add('visible');
  clearTimeout(labelTimer);
  labelTimer = setTimeout(() => label.classList.remove('visible'), 2500);
});

// 클릭하면 잠깐 상태 라벨을 보여줌 (마우스오버 대용)
petRoot.addEventListener('mouseenter', () => label.classList.add('visible'));
petRoot.addEventListener('mouseleave', () => {
  if (!petRoot.classList.contains('state-notify')) {
    clearTimeout(labelTimer);
    labelTimer = setTimeout(() => label.classList.remove('visible'), 400);
  }
});

init();
