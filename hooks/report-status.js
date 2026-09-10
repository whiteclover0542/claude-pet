#!/usr/bin/env node
/**
 * Claude Code 훅 핸들러.
 * 사용법: node report-status.js <state>
 *   state: idle | thinking | working | notify | end
 *
 * Claude Code는 이벤트마다 이 스크립트를 실행하면서 JSON 컨텍스트를 stdin으로
 * 넘겨준다. 거기서 session_id / transcript_path / cwd 를 받아, 트랜스크립트
 * 끝부분을 훑어 "채팅 제목 · 마지막 질문 · 마지막 답변"까지 뽑은 뒤
 * ~/.claude-pet/sessions/<session_id>.json 에 기록한다.
 *
 * 세션마다 파일을 따로 쓰기 때문에 VSCode와 터미널에서 동시에 돌려도
 * 각각의 상태가 섞이지 않는다. (앱이 가장 최근 파일을 골라 보여준다.)
 *
 * Claude Code 동작을 절대 방해하면 안 되므로 모든 실패는 조용히 무시한다.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const state = process.argv[2] || 'idle';
const DATA_DIR = path.join(os.homedir(), '.claude-pet');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

const STDIN_TIMEOUT_MS = 800;
const TRANSCRIPT_TAIL_BYTES = 256 * 1024; // 끝부분만 읽어서 큰 파일도 빠르게
const MAX_TEXT = 600;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12시간 지난 세션 파일은 정리

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(data);
    };
    if (process.stdin.isTTY) return finish();
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    // stdin이 닫히지 않는 예외 상황 대비
    setTimeout(finish, timeoutMs).unref();
  });
}

/** 파일 끝 maxBytes만 읽는다. 잘린 첫 줄은 버린다. */
function readTailLines(file, maxBytes) {
  let fd;
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    if (len <= 0) return [];
    const buf = Buffer.alloc(len);
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, start);
    const lines = buf.toString('utf-8').split('\n');
    if (start > 0) lines.shift(); // 앞쪽이 잘렸을 수 있으므로 첫 줄 폐기
    return lines.filter(Boolean);
  } catch (e) {
    return [];
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (e) { /* noop */ }
    }
  }
}

function squash(text) {
  if (typeof text !== 'string') return '';
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t;
}

/** assistant/user 메시지의 content 배열에서 텍스트 블록만 이어붙인다 */
function textOf(message) {
  if (!message) return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join(' ');
}

/**
 * 트랜스크립트 끝부분에서 화면에 띄울 정보를 뽑는다.
 * - aiTitle:    Claude가 붙인 채팅 제목 ("새 채팅" 이전엔 없음)
 * - prompt:     마지막 사용자 질문
 * - reply:      마지막 어시스턴트 답변 (도구 호출만 있는 턴은 건너뜀)
 * - entrypoint: claude-vscode 등 어디서 돌고 있는지
 */
function scanTranscript(transcriptPath) {
  const out = { title: null, prompt: null, reply: null, entrypoint: null, gitBranch: null };
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return out;

  const lines = readTailLines(transcriptPath, TRANSCRIPT_TAIL_BYTES);
  for (let i = lines.length - 1; i >= 0; i--) {
    let o;
    try {
      o = JSON.parse(lines[i]);
    } catch (e) {
      continue;
    }
    if (!o || typeof o !== 'object') continue;

    if (!out.entrypoint && o.entrypoint) out.entrypoint = o.entrypoint;
    if (!out.gitBranch && o.gitBranch) out.gitBranch = o.gitBranch;
    if (!out.title && o.type === 'ai-title' && o.aiTitle) out.title = o.aiTitle;
    if (!out.prompt && o.type === 'last-prompt' && o.lastPrompt) out.prompt = squash(o.lastPrompt);

    if (!out.prompt && o.type === 'user' && !o.isSidechain && o.message) {
      const t = textOf(o.message);
      if (t) out.prompt = squash(t);
    }
    if (!out.reply && o.type === 'assistant' && !o.isSidechain && o.message) {
      const t = textOf(o.message);
      if (t) out.reply = squash(t);
    }

    if (out.title && out.prompt && out.reply && out.entrypoint) break;
  }
  return out;
}

/** 오래된 세션 파일 정리 */
function pruneSessions() {
  try {
    const now = Date.now();
    fs.readdirSync(SESSIONS_DIR).forEach((name) => {
      if (!name.endsWith('.json')) return;
      const p = path.join(SESSIONS_DIR, name);
      try {
        if (now - fs.statSync(p).mtimeMs > SESSION_TTL_MS) fs.unlinkSync(p);
      } catch (e) { /* noop */ }
    });
  } catch (e) { /* noop */ }
}

(async () => {
  const raw = await readStdin(STDIN_TIMEOUT_MS);
  let ctx = {};
  try {
    ctx = JSON.parse(raw) || {};
  } catch (e) {
    ctx = {};
  }

  const sessionId = ctx.session_id || 'unknown';
  const safeId = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '_');

  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });

    // 세션이 끝나면 파일을 지워서 펫이 죽은 세션을 붙들고 있지 않게 한다
    if (state === 'end') {
      try { fs.unlinkSync(path.join(SESSIONS_DIR, `${safeId}.json`)); } catch (e) { /* noop */ }
      pruneSessions();
      process.exit(0);
    }

    const scanned = scanTranscript(ctx.transcript_path);
    const prev = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `${safeId}.json`), 'utf-8'));
      } catch (e) {
        return {};
      }
    })();

    const record = {
      sessionId,
      state,
      // UserPromptSubmit 훅은 prompt를 직접 준다 (트랜스크립트보다 빠름)
      prompt: squash(ctx.prompt) || scanned.prompt || prev.prompt || null,
      title: scanned.title || prev.title || null,
      // 답변은 턴이 끝났을 때(idle)만 갱신 — 도중엔 이전 답변을 그대로 둔다
      reply: state === 'idle' ? scanned.reply || null : prev.reply || null,
      replyAt: state === 'idle' && scanned.reply && scanned.reply !== prev.reply
        ? Date.now()
        : prev.replyAt || null,
      tool: ctx.tool_name || null,
      hookEvent: ctx.hook_event_name || null,
      cwd: ctx.cwd || prev.cwd || null,
      entrypoint: scanned.entrypoint || prev.entrypoint || null,
      gitBranch: scanned.gitBranch || prev.gitBranch || null,
      updatedAt: Date.now()
    };

    fs.writeFileSync(path.join(SESSIONS_DIR, `${safeId}.json`), JSON.stringify(record, null, 2));
    pruneSessions();
  } catch (e) {
    // 상태 기록 실패가 Claude Code를 막으면 안 된다
  }

  process.exit(0);
})();
