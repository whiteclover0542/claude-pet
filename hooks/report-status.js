#!/usr/bin/env node
/**
 * Claude Code 훅 핸들러.
 * 사용법: node report-status.js <state>
 *   state: idle | thinking | working | notify | end
 *   (notify 중 알림 문구가 "사용량 한도 도달"로 읽히면 내부적으로 limit로
 *    바꿔 기록한다 — 시무룩 표정은 이때만 써야 하기 때문)
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
const { spawn } = require('child_process');

const rawState = process.argv[2] || 'idle';
const DATA_DIR = path.join(os.homedir(), '.claude-pet');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const LAUNCH_INFO_PATH = path.join(DATA_DIR, 'launch-info.json');

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

/** 단어 중간이 아니라 공백 경계에서 자연스럽게 자른다 */
function truncateAtWordBoundary(text, max) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const slice = t.slice(0, max);
  const cut = slice.lastIndexOf(' ');
  return `${(cut > max * 0.4 ? slice.slice(0, cut) : slice).trim()}…`;
}

/**
 * 답변 텍스트에서 마크다운 기호를 걷어내 "말"만 남긴다. 코드 블록·표·
 * 목록 기호가 그대로 남아 있으면 마지막 문장을 골라도 지저분하다.
 */
function stripMarkdown(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' ') // 코드 블록은 통째로 제거
    .replace(/`([^`]+)`/g, '$1') // 인라인 코드는 백틱만 벗긴다
    .replace(/^#{1,6}\s+/gm, '') // 헤더 기호
    .replace(/^\s*[-*+]\s+/gm, '') // 불릿 목록 기호
    .replace(/^\s*\d+[.)]\s+/gm, '') // 번호 목록 기호
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 링크는 텍스트만
    .replace(/\*\*([^*]+)\*\*/g, '$1') // 볼드
    .replace(/\*([^*]+)\*/g, '$1') // 이탤릭
    .replace(/^>\s+/gm, ''); // 인용 기호
}

/**
 * 말풍선 둘째 줄에 "✅ 방금 답변" 식으로 보여줄 짧은 문장. 답변 전체를
 * 앞에서부터 자르면 도입부만 남으므로, 보통 마무리 인사나 결론이 담긴
 * 마지막 줄 · 마지막 문장을 골라 자연스럽게 보여준다.
 *
 * 마크다운 기호를 먼저 걷어내고, 목록 항목처럼 줄바꿈으로 나뉘어 있어
 * 문장부호가 없는 경우까지 한 문장으로 뭉쳐지지 않도록 줄 단위로 먼저
 * 자른 뒤 그 안에서 마지막 문장을 고른다.
 */
function sentenceGist(text, max) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const lines = stripMarkdown(text)
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const lastLine = lines[lines.length - 1];
  const sentences = lastLine.split(/(?<=[.!?。！？])\s+/).map((s) => s.trim()).filter(Boolean);

  let picked = null;
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (sentences[i].length >= 4) {
      picked = sentences[i];
      break;
    }
  }
  picked = picked || lastLine;
  return truncateAtWordBoundary(picked, max);
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
  const out = { title: null, prompt: null, reply: null, replyRaw: null, entrypoint: null, gitBranch: null };
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
      if (t) {
        out.reply = squash(t);
        out.replyRaw = t; // 줄바꿈이 살아 있어야 sentenceGist()가 마지막 줄을 고를 수 있다
      }
    }

    if (out.title && out.prompt && out.reply && out.entrypoint) break;
  }
  return out;
}

/**
 * 펫 앱이 안 떠 있으면 새로 띄운다. 이미 떠 있으면 앱의
 * requestSingleInstanceLock이 이 새 인스턴스를 조용히 즉시 종료시키므로,
 * "떠 있는지 미리 확인"하지 않고 매번 그냥 실행을 시도해도 안전하다.
 */
function launchPetAppIfNeeded() {
  try {
    if (!fs.existsSync(LAUNCH_INFO_PATH)) return;
    const info = JSON.parse(fs.readFileSync(LAUNCH_INFO_PATH, 'utf-8'));
    if (!info.execPath) return;
    // 이 환경 특유의 ELECTRON_RUN_AS_NODE가 남아 있으면 electron이 순수
    // Node로 동작해 버려 창이 안 뜬다. 자식 프로세스에는 물려주지 않는다.
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(info.execPath, info.args || [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env
    });
    child.unref();
  } catch (e) {
    // Claude Code 동작에 영향을 주면 안 되므로 조용히 무시
  }
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

  // Claude Code가 막 시작됐다 — 펫이 안 떠 있으면 띄운다
  if (ctx.hook_event_name === 'SessionStart') launchPetAppIfNeeded();

  try {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });

    // 세션이 끝나면 파일을 지워서 펫이 죽은 세션을 붙들고 있지 않게 한다
    if (rawState === 'end') {
      try { fs.unlinkSync(path.join(SESSIONS_DIR, `${safeId}.json`)); } catch (e) { /* noop */ }
      pruneSessions();
      process.exit(0);
    }

    // Notification 훅은 권한 확인 같은 일반 알림과 "사용량 한도 도달"을
    // 구분 없이 똑같이 보낸다. 시무룩(sulky) 표정은 한도 도달 때만 써야
    // 하므로, 알림 메시지 문구로 그 경우만 따로 골라낸다.
    const isUsageLimit = /usage limit|rate limit|limit reached|resets? at|사용량\s*한도|한도\s*도달|토큰.{0,4}(소진|부족|한도)/i.test(
      ctx.message || ''
    );
    const state = rawState === 'notify' && isUsageLimit ? 'limit' : rawState;

    const scanned = scanTranscript(ctx.transcript_path);
    const prev = (() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `${safeId}.json`), 'utf-8'));
      } catch (e) {
        return {};
      }
    })();

    // 답변은 턴이 끝났을 때(idle)만 갱신 — 도중엔 이전 답변을 그대로 둔다
    const reply = state === 'idle' ? scanned.reply || null : prev.reply || null;
    // replyRaw(줄바꿈 보존)가 있어야 sentenceGist가 마지막 줄을 정확히 고른다
    const replyGist = state === 'idle'
      ? (scanned.reply ? sentenceGist(scanned.replyRaw || scanned.reply, 40) : null)
      : prev.replyGist || null;

    const record = {
      sessionId,
      state,
      // UserPromptSubmit 훅은 prompt를 직접 준다 (트랜스크립트보다 빠름)
      prompt: squash(ctx.prompt) || scanned.prompt || prev.prompt || null,
      title: scanned.title || prev.title || null,
      reply,
      replyAt: state === 'idle' && scanned.reply && scanned.reply !== prev.reply
        ? Date.now()
        : prev.replyAt || null,
      // 말풍선 둘째 줄에 "✅ ~" 형태로 보여줄 답변 마지막 문장 요약
      replyGist,
      // 한도 도달 알림의 원문(리셋 시각 등)을 말풍선에 그대로 보여줄 수 있게 남겨둔다
      message: state === 'limit' ? squash(ctx.message) : null,
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
