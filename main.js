const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

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
// SessionStart 훅이 "펫이 안 떠 있으면 띄워라"를 하려면 이 앱을 어떻게
// 다시 실행하는지 알아야 한다. process.execPath는 개발 모드든 패키징된
// 앱이든 실제 electron(또는 앱) 실행 파일을 정확히 가리키므로 그대로 적어둔다.
const LAUNCH_INFO_PATH = path.join(DATA_DIR, 'launch-info.json');

const DEFAULT_CONFIG = {
  character: 'mong',
  corner: 'bottom-right', // 저장된 위치가 없을 때만 쓰인다
  x: null,
  y: null,
  scale: 1.0 // 0.5 ~ 2.0
};

// 시트 로딩에 실패했을 때만 쓰는 기본 비율
const FALLBACK_ASPECT = { w: 160, h: 174 };
const BASE_PET_HEIGHT = 150; // scale 1.0일 때 펫 높이(px)
const BUBBLE_W = 220; // renderer/style.css의 #bubble max-width와 맞춘다
const BUBBLE_SPACE = 210; // 말풍선이 펼쳐졌을 때 필요한 위쪽 여백
const PANEL_SPACE = 130; // 펫을 클릭해서 여는 설정 패널에 필요한 아래쪽 여백

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
  // SessionStart 훅이 이 앱을 다시 실행할 수 있도록, 실행 파일 경로를
  // 매번 최신 상태로 적어 둔다. 개발 모드에선 electron.exe + 프로젝트
  // 경로, 패키징된 앱에선 그 실행 파일 자체(인자 없이 실행)면 된다.
  try {
    fs.writeFileSync(LAUNCH_INFO_PATH, JSON.stringify({
      execPath: process.execPath,
      args: app.isPackaged ? [] : [__dirname]
    }, null, 2));
  } catch (e) {
    console.error('launch-info 기록 실패:', e);
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

/** 설정을 렌더러가 바로 쓸 수 있는 형태로 (계산된 픽셀 크기 + 캐릭터 목록 포함) */
function viewConfig() {
  const cfg = readConfig();
  const characters = availableCharacters().map((id) => {
    const def = readJsonSafe(path.join(__dirname, 'assets', 'characters', `${id}.json`), {});
    return { id, name: def.name || id };
  });
  return { ...cfg, petHeight: Math.round(BASE_PET_HEIGHT * cfg.scale), characters };
}

/** 캐릭터 시트에서 실제 가로세로 비율을 구한다 (sprite.js와 같은 계산 방식) */
function characterAspect(charId) {
  const def = readJsonSafe(path.join(__dirname, 'assets', 'characters', `${charId}.json`), null);
  const clips = def && def.clips && Object.values(def.clips);
  if (!clips || !clips.length) return FALLBACK_ASPECT;
  return {
    w: Math.max(...clips.map((c) => c.cellW)),
    h: Math.max(...clips.map((c) => c.cellH))
  };
}

function windowSize(charId, scale) {
  const aspect = characterAspect(charId);
  const petH = Math.round(BASE_PET_HEIGHT * scale);
  const petW = Math.round((aspect.w * petH) / aspect.h);
  return {
    width: Math.max(petW, BUBBLE_W) + 16,
    height: petH + BUBBLE_SPACE + PANEL_SPACE
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
  const size = windowSize(cfg.character, cfg.scale);
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
      nodeIntegration: false,
      // 포커스 없는 창(focusable: false)이라 기본 스로틀링이 걸리면
      // 애니메이션 프레임이나 잠들기·달리기 전환 타이머가 늦게 돈다
      backgroundThrottling: false
    }
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 기본은 통과. 렌더러가 펫/말풍선 위에 마우스가 올라올 때만 켠다.
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Windows는 topmost 창이 여러 개 있으면 "나중에 topmost 플래그가 다시
  // 세팅된 쪽"이 위로 올라온다. 스스로 계속 topmost를 거는 게임 등과
  // 마주치면 결국 밀릴 수 있지만(이런 경우는 Electron 표준 API로는
  // 이기기 어려운 근본적 한계), 평소 일반 앱들 사이에서는 이 주기적
  // 재적용만으로 충분히 맨 위를 유지한다.
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
  }, 2500);

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('config-updated', viewConfig());
    mainWindow.webContents.send('session-updated', activeSessionPayload());
  });
}

/**
 * 크기나 캐릭터처럼 창 치수에 영향을 주는 설정을 바꾼다.
 * 창을 다시 재고, 화면 밖으로 나가지 않게 맞춘다.
 */
function applySizingConfig(partial) {
  const cfg = writeConfig(partial);
  if (!mainWindow) return cfg;
  const size = windowSize(cfg.character, cfg.scale);
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
// 5.5 말풍선에서 원래 화면(VSCode/터미널)으로 이동하기 (Windows 전용)
//
// 세션이 어느 OS 창인지는 직접 알 방법이 없어서, cwd의 마지막 폴더 이름이
// 창 제목에 들어 있을 거라 가정하고 부분 일치로 찾는다. VSCode는 보통
// 창 제목에 폴더 이름이 들어가 있어 잘 맞지만, 터미널은 프롬프트가 제목을
// 따로 안 바꿔주면 못 찾을 수 있다 — 그런 경우는 조용히 실패한다.
// SetForegroundWindow를 직접 부르면 Windows가 "다른 프로세스가 포커스를
// 뺏는 것"을 막아서 거의 항상 무시되므로, WScript.Shell의 AppActivate로
// 우회한다(같은 이유로 이 방식이 훨씬 잘 먹힌다).
// ---------------------------------------------------------------------------
function psEscape(s) {
  return String(s).replace(/'/g, "''");
}

function focusSourceWindow(session) {
  if (!session || !session.cwd || process.platform !== 'win32') return;
  const folder = path.basename(session.cwd);
  if (!folder) return;
  const ps = `$shell = New-Object -ComObject WScript.Shell; [void]$shell.AppActivate('${psEscape(folder)}')`;
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], () => {
    // 못 찾아도 Claude Code나 펫 동작에 영향이 없어야 하므로 조용히 무시
  });
}

// 답변 도착 후 그 창이 포커스될 때까지 지켜본다
const FOCUS_WATCH_POLL_MS = 1500;
const FOCUS_WATCH_TIMEOUT_MS = 5 * 60 * 1000; // 5분 넘게 안 돌아오면 그만 지켜본다
const GET_FOREGROUND_TITLE_PS = `Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ClaudePetFocus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
'@
$h = [ClaudePetFocus]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 256
[ClaudePetFocus]::GetWindowText($h, $sb, 256) | Out-Null
Write-Output $sb.ToString()`;

let focusWatch = null; // { sessionId, folder, timer, deadline }

function stopFocusWatch() {
  if (focusWatch) {
    clearInterval(focusWatch.timer);
    focusWatch = null;
  }
}

function startFocusWatch(session) {
  stopFocusWatch();
  if (!session || !session.cwd || !session.sessionId || process.platform !== 'win32') return;
  const folder = path.basename(session.cwd).toLowerCase();
  if (!folder) return;

  const deadline = Date.now() + FOCUS_WATCH_TIMEOUT_MS;
  const check = () => {
    if (!focusWatch || Date.now() > deadline) return stopFocusWatch();
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', GET_FOREGROUND_TITLE_PS], (err, stdout) => {
      if (err || !focusWatch) return;
      const title = String(stdout || '').trim().toLowerCase();
      if (title && title.includes(folder)) {
        stopFocusWatch();
        mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.send('source-window-focused', session.sessionId);
      }
    });
  };
  focusWatch = { timer: setInterval(check, FOCUS_WATCH_POLL_MS) };
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
      applySizingConfig({ scale });
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
      const c = readConfig();
      const size = windowSize(c.character, c.scale);
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
        applySizingConfig({ character: name });
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
  if (partial && (typeof partial.scale === 'number' || partial.character)) return applySizingConfig(partial);
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
ipcMain.on('quit-app', () => app.exit(0));

ipcMain.on('focus-session-window', (_e, session) => focusSourceWindow(session));
ipcMain.on('watch-for-focus', (_e, session) => startFocusWatch(session));

ipcMain.on('set-interactive', (_e, on) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setIgnoreMouseEvents(!on, { forward: true });
});

/**
 * 창을 (nx,ny)로 옮겼을 때 펫이 실제로 보이는 영역(offset만큼 안쪽)이
 * 화면 밖으로 완전히 나가지만 않으면 그대로 이동을 허용한다.
 *
 * 예전엔 "가장 가까운 디스플레이 하나"의 workArea로만 clamp했는데, 그
 * 기준점이 창의 왼쪽-위 좌표(nx,ny)였다. 펫이 모니터 경계를 넘어가려는
 * 순간 nx는 아직 원래 모니터 안에 있으니 즉시 그 모니터 안으로 되돌려져
 * 버려서, 듀얼 모니터에서 펫이 절대 옆 모니터로 못 넘어가는 문제가 있었다.
 * 지금은 "펫 사각형이 어느 디스플레이와든 겹치기만 하면 허용"으로 바꿔서
 * 모니터 사이를 자유롭게 오갈 수 있다.
 */
function clampPetVisible(nx, ny, w, h, offset) {
  const o = offset || { top: 0, left: 0, right: 0, bottom: 0 };
  const pet = { x: nx + o.left, y: ny + o.top, width: w - o.left - o.right, height: h - o.top - o.bottom };
  const overlaps = (a, b) =>
    Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
    Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);

  if (screen.getAllDisplays().some((d) => overlaps(pet, d.workArea))) {
    return { x: nx, y: ny };
  }

  // 완전히 화면 밖으로 나가려 하면, 펫 중심에서 가장 가까운 디스플레이의
  // workArea 경계 안으로 되돌린다.
  const center = { x: Math.round(pet.x + pet.width / 2), y: Math.round(pet.y + pet.height / 2) };
  const { workArea } = screen.getDisplayNearestPoint(center);
  const minX = workArea.x - o.left;
  const maxX = workArea.x + workArea.width - w + o.right;
  const minY = workArea.y - o.top;
  const maxY = workArea.y + workArea.height - h + o.bottom;
  return {
    x: Math.round(Math.min(Math.max(nx, minX), Math.max(minX, maxX))),
    y: Math.round(Math.min(Math.max(ny, minY), Math.max(minY, maxY)))
  };
}

ipcMain.on('drag-window-by', (_e, { dx, dy, offset }) => {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  const [w, h] = mainWindow.getSize();
  const nx = Math.round(x + dx);
  const ny = Math.round(y + dy);
  const clamped = clampPetVisible(nx, ny, w, h, offset);
  mainWindow.setPosition(clamped.x, clamped.y);
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
    try {
      ensureDataDir();
      createWindow();
      createTray();
      watchSessions();
    } catch (e) {
      fs.writeFileSync(path.join(os.tmpdir(), 'claude-pet-startup-error.txt'), String(e && e.stack || e));
    }
  });
  process.on('uncaughtException', (e) => {
    try {
      fs.appendFileSync(path.join(os.tmpdir(), 'claude-pet-startup-error.txt'), '\n[uncaught] ' + String(e && e.stack || e));
    } catch (_) { /* noop */ }
  });
}

app.on('window-all-closed', () => {
  // 트레이 상주 앱이므로 창이 닫혀도 종료하지 않는다
});
