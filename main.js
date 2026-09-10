const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---------------------------------------------------------------------------
// 1. 데이터 디렉토리 준비 (~/.claude-pet)
//    - config.json  : 캐릭터/색상/위치 등 사용자 설정
//    - status.json  : Claude Code 훅이 기록하는 현재 상태
//    - hooks/        : Claude Code 훅에서 호출할 상태 기록 스크립트
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(os.homedir(), '.claude-pet');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const STATUS_PATH = path.join(DATA_DIR, 'status.json');
const HOOKS_DIR = path.join(DATA_DIR, 'hooks');
const HOOK_SCRIPT_DEST = path.join(HOOKS_DIR, 'report-status.js');
const HOOK_SCRIPT_SRC = path.join(__dirname, 'hooks', 'report-status.js');

const DEFAULT_CONFIG = {
  character: 'robot', // robot | cat | ghost | slime
  color: '#4f7cff',
  corner: 'bottom-right', // bottom-right | bottom-left | top-right | top-left
  scale: 1.0
};

const DEFAULT_STATUS = {
  state: 'idle', // idle | thinking | working | notify
  tool: null,
  updatedAt: Date.now()
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(HOOKS_DIR)) fs.mkdirSync(HOOKS_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
  if (!fs.existsSync(STATUS_PATH)) {
    fs.writeFileSync(STATUS_PATH, JSON.stringify(DEFAULT_STATUS, null, 2));
  }
  // 훅 스크립트를 항상 최신 버전으로 복사 (앱 업데이트 시 동기화)
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

function readConfig() {
  return { ...DEFAULT_CONFIG, ...readJsonSafe(CONFIG_PATH, {}) };
}

function writeConfig(cfg) {
  const merged = { ...readConfig(), ...cfg };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

function readStatus() {
  return { ...DEFAULT_STATUS, ...readJsonSafe(STATUS_PATH, {}) };
}

// ---------------------------------------------------------------------------
// 2. 메인 창 (펫 오버레이)
// ---------------------------------------------------------------------------
let mainWindow = null;
let tray = null;

const WIN_SIZE = { width: 180, height: 220 };

function cornerToPosition(corner, size) {
  const { workArea } = screen.getPrimaryDisplay();
  const margin = 24;
  switch (corner) {
    case 'bottom-left':
      return { x: workArea.x + margin, y: workArea.y + workArea.height - size.height - margin };
    case 'top-right':
      return { x: workArea.x + workArea.width - size.width - margin, y: workArea.y + margin };
    case 'top-left':
      return { x: workArea.x + margin, y: workArea.y + margin };
    case 'bottom-right':
    default:
      return {
        x: workArea.x + workArea.width - size.width - margin,
        y: workArea.y + workArea.height - size.height - margin
      };
  }
}

function createWindow() {
  const cfg = readConfig();
  const pos = cornerToPosition(cfg.corner, WIN_SIZE);

  mainWindow = new BrowserWindow({
    width: WIN_SIZE.width,
    height: WIN_SIZE.height,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // 다른 창을 조작할 때 포커스를 뺏지 않도록 floating 레벨 사용 (macOS/Linux)
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('config-updated', readConfig());
    mainWindow.webContents.send('status-updated', readStatus());
  });
}

function moveWindowToCorner(corner) {
  if (!mainWindow) return;
  const pos = cornerToPosition(corner, WIN_SIZE);
  mainWindow.setPosition(pos.x, pos.y);
}

// ---------------------------------------------------------------------------
// 3. status.json 감시 → 렌더러에 실시간 반영
// ---------------------------------------------------------------------------
let lastStatusRaw = '';
function watchStatusFile() {
  fs.watchFile(STATUS_PATH, { interval: 300 }, () => {
    const raw = readJsonSafe(STATUS_PATH, DEFAULT_STATUS);
    const rawStr = JSON.stringify(raw);
    if (rawStr === lastStatusRaw) return;
    lastStatusRaw = rawStr;
    if (mainWindow) mainWindow.webContents.send('status-updated', raw);
  });
}

// ---------------------------------------------------------------------------
// 4. Claude Code 훅 연동 설정 (~/.claude/settings.json 자동 병합)
// ---------------------------------------------------------------------------
function claudeSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function buildHookEntry(stateArg) {
  return {
    type: 'command',
    command: 'node',
    args: [HOOK_SCRIPT_DEST, stateArg]
  };
}

function setupClaudeCodeHooks() {
  const settingsPath = claudeSettingsPath();
  const settingsDir = path.dirname(settingsPath);
  if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir, { recursive: true });

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    settings = readJsonSafe(settingsPath, {});
  }
  if (!settings.hooks) settings.hooks = {};

  const wanted = {
    UserPromptSubmit: [{ matcher: '*', hooks: [buildHookEntry('thinking')] }],
    PreToolUse: [{ matcher: '*', hooks: [buildHookEntry('working')] }],
    PostToolUse: [{ matcher: '*', hooks: [buildHookEntry('working')] }],
    Stop: [{ matcher: '*', hooks: [buildHookEntry('idle')] }],
    Notification: [{ matcher: '*', hooks: [buildHookEntry('notify')] }],
    SessionStart: [{ matcher: '*', hooks: [buildHookEntry('idle')] }],
    SessionEnd: [{ matcher: '*', hooks: [buildHookEntry('idle')] }]
  };

  // 이미 claude-pet 훅이 등록되어 있으면 건너뛰고, 없으면 이벤트별로 추가
  Object.keys(wanted).forEach((eventName) => {
    if (!Array.isArray(settings.hooks[eventName])) settings.hooks[eventName] = [];
    const already = settings.hooks[eventName].some((group) =>
      (group.hooks || []).some(
        (h) => h.type === 'command' && h.command === 'node' && Array.isArray(h.args) && h.args[0] === HOOK_SCRIPT_DEST
      )
    );
    if (!already) {
      settings.hooks[eventName] = settings.hooks[eventName].concat(wanted[eventName]);
    }
  });

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  return settingsPath;
}

// ---------------------------------------------------------------------------
// 5. 트레이 메뉴
// ---------------------------------------------------------------------------
function buildTrayMenu() {
  const cfg = readConfig();
  const characterItems = ['robot', 'cat', 'ghost', 'slime'].map((c) => ({
    label: { robot: '로봇', cat: '고양이', ghost: '유령', slime: '슬라임' }[c],
    type: 'radio',
    checked: cfg.character === c,
    click: () => {
      const updated = writeConfig({ character: c });
      mainWindow && mainWindow.webContents.send('config-updated', updated);
    }
  }));

  const colorItems = [
    ['블루', '#4f7cff'],
    ['퍼플', '#9b5de5'],
    ['그린', '#2ec4b6'],
    ['오렌지', '#ff9f1c'],
    ['핑크', '#ff5d8f']
  ].map(([label, hex]) => ({
    label,
    type: 'radio',
    checked: cfg.color === hex,
    click: () => {
      const updated = writeConfig({ color: hex });
      mainWindow && mainWindow.webContents.send('config-updated', updated);
    }
  }));

  const cornerItems = [
    ['오른쪽 아래', 'bottom-right'],
    ['왼쪽 아래', 'bottom-left'],
    ['오른쪽 위', 'top-right'],
    ['왼쪽 위', 'top-left']
  ].map(([label, corner]) => ({
    label,
    type: 'radio',
    checked: cfg.corner === corner,
    click: () => {
      const updated = writeConfig({ corner });
      moveWindowToCorner(corner);
    }
  }));

  return Menu.buildFromTemplate([
    { label: 'Claude Pet', enabled: false },
    { type: 'separator' },
    { label: '캐릭터', submenu: characterItems },
    { label: '색상', submenu: colorItems },
    { label: '위치', submenu: cornerItems },
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
    { type: 'separator' },
    { label: '종료', click: () => app.quit() }
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
// 6. IPC
// ---------------------------------------------------------------------------
ipcMain.handle('get-config', () => readConfig());
ipcMain.handle('get-status', () => readStatus());
ipcMain.handle('set-config', (evt, partial) => {
  const updated = writeConfig(partial);
  tray && tray.setContextMenu(buildTrayMenu());
  return updated;
});
ipcMain.handle('setup-hooks', () => {
  const p = setupClaudeCodeHooks();
  return { ok: true, path: p };
});
ipcMain.on('drag-window', (evt, { x, y }) => {
  if (mainWindow) mainWindow.setPosition(Math.round(x), Math.round(y));
});

// ---------------------------------------------------------------------------
app.whenReady().then(() => {
  ensureDataDir();
  createWindow();
  createTray();
  watchStatusFile();
});

app.on('window-all-closed', (e) => {
  // 트레이 상주 앱이므로 창을 닫아도 종료하지 않음
  e.preventDefault && e.preventDefault();
});
