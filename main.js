const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---------------------------------------------------------------------------
// 1. 데이터 디렉토리 (~/.claude-pet)
//    - config.json  : 캐릭터/크기/위치 등 사용자 설정
//    - sessions/    : Claude Code 훅이 세션마다 기록하는 상태 파일
//    - hooks/       : Claude Code가 실행할 상태 기록 스크립트
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(os.homedir(), '.claude-pet');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const HOOKS_DIR = path.join(DATA_DIR, 'hooks');
const HOOK_SCRIPT_DEST = path.join(HOOKS_DIR, 'report-status.js');
const HOOK_SCRIPT_SRC = path.join(__dirname, 'hooks', 'report-status.js');

const DEFAULT_CONFIG = {
  character: 'bichon',
  corner: 'bottom-right', // 저장된 위치가 없을 때만 쓰인다
  x: null,
  y: null,
  scale: 1.0 // 0.5 ~ 2.0
};

// 스프라이트 기준 칸 크기 (assets/characters/bichon.json의 최대 셀)
const SPRITE_REF = { w: 160, h: 174 };
const BASE_PET_HEIGHT = 150; // scale 1.0일 때 펫 높이(px)
const BUBBLE_W = 330;
const BUBBLE_SPACE = 210; // 말풍선이 펼쳐졌을 때 필요한 위쪽 여백

// 이 시간 이상 갱신이 없는 세션은 죽은 것으로 보고 무시한다
const SESSION_STALE_MS = 15 * 60 * 1000;

function ensureDataDir() {
  [DATA_DIR, SESSIONS_DIR, HOOKS_DIR].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
  // 훅 스크립트를 항상 최신으로 유지 (앱 업데이트 시 동기화)
  try {
    fs.copyFileSync(HOOK_SCRIPT_SRC, HOOK_SCRIPT_DEST);
  } catch (e) {
    console.error('훅 스크립트 복사 실패:', e);
  }
}

function readJsonSafe(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    return fallback;
  }
}

/** assets/characters에 실제로 들어 있는 시트 이름들 */
function availableCharacters() {
  try {
    return fs
      .readdirSync(path.join(__dirname, 'assets', 'characters'))
      .filter((n) => n.endsWith('.json'))
      .map((n) => n.slice(0, -'.json'.length));
  } catch (e) {
    return [];
  }
}

function readConfig() {
  const cfg = { ...DEFAULT_CONFIG, ...readJsonSafe(CONFIG_PATH, {}) };
  // 예전 설정이나 지워진 시트를 가리키고 있으면 있는 것으로 되돌린다
  const available = availableCharacters();
  if (available.length && !available.includes(cfg.character)) {
    cfg.character = available.includes(DEFAULT_CONFIG.character)
      ? DEFAULT_CONFIG.character
      : available[0];
  }
  return cfg;
}

function writeConfig(partial) {
  const merged = { ...readConfig(), ...partial };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

/** 설정을 렌더러가 바로 쓸 수 있는 형태로 (계산된 픽셀 크기 포함) */
function viewConfig() {
  const cfg = readConfig();
  return { ...cfg, petHeight: Math.round(BASE_PET_HEIGHT * cfg.scale) };
}

function windowSize(scale) {
  const petH = Math.round(BASE_PET_HEIGHT * scale);
  const petW = Math.round((SPRITE_REF.w * petH) / SPRITE_REF.h);
  return {
    width: Math.max(petW, BUBBLE_W) + 16,
    height: petH + BUBBLE_SPACE
  };
}

// ---------------------------------------------------------------------------
// 2. 세션 상태 읽기
// ---------------------------------------------------------------------------
/** sessions/*.json을 최근 갱신 순으로 읽는다 */
function readSessions() {
  let names = [];
  try {
    names = fs.readdirSync(SESSIONS_DIR).filter((n) => n.endsWith('.json'));
  } catch (e) {
    return [];
  }
  const now = Date.now();
  return names
    .map((n) => readJsonSafe(path.join(SESSIONS_DIR, n), null))
    .filter((s) => s && s.updatedAt && now - s.updatedAt < SESSION_STALE_MS)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// 사용자가 점을 눌러 고정한 세션 (없으면 항상 가장 최근 세션을 따라간다)
let pinnedSessionId = null;

function activeSessionPayload() {
  const sessions = readSessions();
  if (!sessions.length) {
    pinnedSessionId = null;
    return { session: null, count: 0, index: 0 };
  }
  let index = 0;
  if (pinnedSessionId) {
    const found = sessions.findIndex((s) => s.sessionId === pinnedSessionId);
    if (found >= 0) index = found;
    else pinnedSessionId = null; // 고정해 둔 세션이 끝났으면 다시 자동 추적
  }
  return { session: sessions[index], count: sessions.length, index };
}

// ---------------------------------------------------------------------------
// 3. 펫 오버레이 창
// ---------------------------------------------------------------------------
let mainWindow = null;
let tray = null;

function defaultPosition(corner, size) {
  const { workArea } = screen.getPrimaryDisplay();
  const margin = 24;
  const right = workArea.x + workArea.width - size.width - margin;
  const bottom = workArea.y + workArea.height - size.height - margin;
  switch (corner) {
    case 'bottom-left': return { x: workArea.x + margin, y: bottom };
    case 'top-right': return { x: right, y: workArea.y + margin };
    case 'top-left': return { x: workArea.x + margin, y: workArea.y + margin };
    default: return { x: right, y: bottom };
  }
}

/** 저장된 좌표가 화면 밖이면 기본 위치로 되돌린다 */
function resolvePosition(cfg, size) {
  if (cfg.x === null || cfg.y === null) return defaultPosition(cfg.corner, size);
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return cfg.x + size.width > a.x && cfg.x < a.x + a.width &&
           cfg.y + size.height > a.y && cfg.y < a.y + a.height;
  });
  return visible ? { x: cfg.x, y: cfg.y } : defaultPosition(cfg.corner, size);
}

function createWindow() {
  const cfg = readConfig();
  const size = windowSize(cfg.scale);
  const pos = resolvePosition(cfg, size);

  mainWindow = new BrowserWindow({
    ...size,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false, // 다른 창의 포커스를 뺏지 않는다
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 기본은 통과. 렌더러가 펫/말풍선 위에 마우스가 올라올 때만 켠다.
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('config-updated', viewConfig());
    mainWindow.webContents.send('session-updated', activeSessionPayload());
  });
}

/** 크기가 바뀌면 창을 다시 재고, 화면 밖으로 나가지 않게 맞춘다 */
function applyScale(scale) {
  const cfg = writeConfig({ scale });
  if (!mainWindow) return cfg;
  const size = windowSize(scale);
  const [x, y] = mainWindow.getPosition();
  const { workArea } = screen.getDisplayNearestPoint({ x, y });
  const nx = Math.min(x, workArea.x + workArea.width - size.width - 8);
  const ny = Math.min(y, workArea.y + workArea.height - size.height - 8);
  mainWindow.setBounds({ x: Math.round(nx), y: Math.round(ny), ...size });
  writeConfig({ x: Math.round(nx), y: Math.round(ny) });
  mainWindow.webContents.send('config-updated', viewConfig());
  return cfg;
}

// ---------------------------------------------------------------------------
// 4. 세션 폴더 감시 → 렌더러에 반영
// ---------------------------------------------------------------------------
let lastPayloadRaw = '';

function pushSession(force) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const payload = activeSessionPayload();
  const raw = JSON.stringify(payload);
  if (!force && raw === lastPayloadRaw) return;
  lastPayloadRaw = raw;
  mainWindow.webContents.send('session-updated', payload);
}

function watchSessions() {
  // fs.watch는 플랫폼마다 놓치는 경우가 있어 폴링을 함께 돌린다
  try {
    fs.watch(SESSIONS_DIR, () => pushSession(false));
  } catch (e) {
    /* 폴링으로 충분하다 */
  }
  setInterval(() => pushSession(false), 700);
}

// ---------------------------------------------------------------------------
// 5. Claude Code 훅 연동 (~/.claude/settings.json 병합)
// ---------------------------------------------------------------------------
function claudeSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function hookEntry(stateArg) {
  return { type: 'command', command: 'node', args: [HOOK_SCRIPT_DEST, stateArg] };
}

function setupClaudeCodeHooks() {
  const settingsPath = claudeSettingsPath();
  const settingsDir = path.dirname(settingsPath);
  if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });

  const settings = fs.existsSync(settingsPath) ? readJsonSafe(settingsPath, {}) : {};
  if (!settings.hooks) settings.hooks = {};

  const wanted = {
    UserPromptSubmit: 'thinking',
    PreToolUse: 'working',
    PostToolUse: 'working',
    Stop: 'idle',
    Notification: 'notify',
    SessionStart: 'idle',
    SessionEnd: 'end'
  };

  Object.entries(wanted).forEach(([eventName, stateArg]) => {
    if (!Array.isArray(settings.hooks[eventName])) settings.hooks[eventName] = [];
    // 이전 버전이 심어 둔 claude-pet 훅은 걷어내고 다시 넣는다 (인자가 바뀌었을 수 있음)
    settings.hooks[eventName] = settings.hooks[eventName].filter((group) =>
      !(group.hooks || []).some((h) => Array.isArray(h.args) && h.args[0] === HOOK_SCRIPT_DEST)
    );
    settings.hooks[eventName].push({ matcher: '*', hooks: [hookEntry(stateArg)] });
  });

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return settingsPath;
}

// ---------------------------------------------------------------------------
// 6. 트레이 메뉴
// ---------------------------------------------------------------------------
function buildTrayMenu() {
  const cfg = readConfig();

  const scaleItems = [
    ['아주 작게 (50%)', 0.5],
    ['작게 (75%)', 0.75],
    ['보통 (100%)', 1.0],
    ['크게 (125%)', 1.25],
    ['더 크게 (150%)', 1.5],
    ['아주 크게 (200%)', 2.0]
  ].map(([label, scale]) => ({
    label,
    type: 'radio',
    checked: Math.abs(cfg.scale - scale) < 0.001,
    click: () => {
      applyScale(scale);
      tray && tray.setContextMenu(buildTrayMenu());
    }
  }));

  const cornerItems = [
    ['오른쪽 아래', 'bottom-right'],
    ['왼쪽 아래', 'bottom-left'],
    ['오른쪽 위', 'top-right'],
    ['왼쪽 위', 'top-left']
  ].map(([label, corner]) => ({
    label,
    click: () => {
      const size = windowSize(readConfig().scale);
      const pos = defaultPosition(corner, size);
      mainWindow && mainWindow.setPosition(pos.x, pos.y);
      writeConfig({ corner, x: pos.x, y: pos.y });
    }
  }));

  // assets/characters에 시트를 넣으면 여기에 자동으로 나타난다
  const characterItems = availableCharacters().map((name) => {
    const def = readJsonSafe(path.join(__dirname, 'assets', 'characters', `${name}.json`), {});
    return {
      label: def.name || name,
      type: 'radio',
      checked: cfg.character === name,
      click: () => {
        writeConfig({ character: name });
        mainWindow && mainWindow.webContents.send('config-updated', viewConfig());
        tray && tray.setContextMenu(buildTrayMenu());
      }
    };
  });

  return Menu.buildFromTemplate([
    { label: 'Claude Pet', enabled: false },
    { type: 'separator' },
    { label: '캐릭터', submenu: characterItems.length ? characterItems : [{ label: '없음', enabled: false }] },
    { label: '크기', submenu: scaleItems },
    { label: '위치 초기화', submenu: cornerItems },
    { type: 'separator' },
    {
      label: 'Claude Code 연동 설정',
      click: () => {
        try {
          const p = setupClaudeCodeHooks();
          mainWindow && mainWindow.webContents.send('setup-result', { ok: true, path: p });
        } catch (e) {
          mainWindow && mainWindow.webContents.send('setup-result', { ok: false, error: String(e) });
        }
      }
    },
    {
      label: '캐릭터 폴더 열기',
      click: () => shell.openPath(path.join(__dirname, 'assets', 'characters'))
    },
    { type: 'separator' },
    { label: '종료', click: () => app.exit(0) }
  ]);
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icons', 'tray.png');
  let img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) img = nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('Claude Pet');
  tray.setContextMenu(buildTrayMenu());
}

// ---------------------------------------------------------------------------
// 7. IPC
// ---------------------------------------------------------------------------
ipcMain.handle('get-config', () => viewConfig());
ipcMain.handle('set-config', (_e, partial) => {
  if (partial && typeof partial.scale === 'number') return applyScale(partial.scale);
  const updated = writeConfig(partial);
  tray && tray.setContextMenu(buildTrayMenu());
  return updated;
});
ipcMain.handle('get-active-session', () => activeSessionPayload());
ipcMain.handle('cycle-session', () => {
  const sessions = readSessions();
  if (sessions.length < 2) return activeSessionPayload();
  const current = activeSessionPayload().index;
  pinnedSessionId = sessions[(current + 1) % sessions.length].sessionId;
  pushSession(true);
  return activeSessionPayload();
});
ipcMain.handle('setup-hooks', () => ({ ok: true, path: setupClaudeCodeHooks() }));

ipcMain.on('set-interactive', (_e, on) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setIgnoreMouseEvents(!on, { forward: true });
});

ipcMain.on('drag-window-by', (_e, { dx, dy }) => {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(Math.round(x + dx), Math.round(y + dy));
});

ipcMain.on('save-window-position', () => {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  writeConfig({ x, y });
});

// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.whenReady().then(() => {
    ensureDataDir();
    createWindow();
    createTray();
    watchSessions();
  });
}

app.on('window-all-closed', () => {
  // 트레이 상주 앱이므로 창이 닫혀도 종료하지 않는다
});
