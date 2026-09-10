#!/usr/bin/env node
/**
 * Claude Code 훅 핸들러.
 * 사용법: node report-status.js <state>
 *   state: idle | thinking | working | notify
 *
 * Claude Code가 이벤트 발생 시 이 스크립트를 실행하며, JSON 컨텍스트를
 * stdin으로 전달합니다. 여기서는 tool_name 정도만 참고용으로 읽고,
 * ~/.claude-pet/status.json 에 현재 상태를 기록합니다.
 * (Claude Pet 앱이 이 파일을 감시하다가 펫 애니메이션을 바꿉니다.)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const state = process.argv[2] || 'idle';
const STATUS_PATH = path.join(os.homedir(), '.claude-pet', 'status.json');

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      resolve(val);
    };
    if (process.stdin.isTTY) {
      finish('');
      return;
    }
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => finish(data));
    process.stdin.on('error', () => finish(data));
    // stdin이 닫히지 않는 예외 상황을 대비한 안전 타임아웃
    setTimeout(() => finish(data), timeoutMs);
  });
}

(async () => {
  const raw = await readStdin(800);
  let tool = null;
  let hookEvent = null;
  try {
    const parsed = JSON.parse(raw);
    tool = parsed.tool_name || null;
    hookEvent = parsed.hook_event_name || null;
  } catch (e) {
    // JSON이 아니거나 비어 있으면 무시
  }

  try {
    fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
    fs.writeFileSync(
      STATUS_PATH,
      JSON.stringify(
        {
          state,
          tool,
          hookEvent,
          updatedAt: Date.now()
        },
        null,
        2
      )
    );
  } catch (e) {
    // 상태 파일 기록 실패는 Claude Code 동작에 영향을 주면 안 되므로 조용히 무시
  }

  process.exit(0);
})();
