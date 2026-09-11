# Claude Pet

Claude Code 작업 상태에 따라 반응하는 데스크톱 오버레이 펫입니다.
화면 한쪽 구석에 항상 떠 있으면서(Always on Top), 지금 돌아가는 채팅의
**제목과 상태를 말풍선으로 보여주고**, 답변이 도착하면 그 자리에 펼쳐 줍니다.
VSCode에서 돌리든 터미널에서 돌리든 똑같이 잡힙니다.

![상태](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

## 이렇게 동작합니다

```
Claude Code 훅  ─▶  ~/.claude-pet/sessions/<세션ID>.json  ─▶  펫 앱
   (이벤트마다)         상태 · 제목 · 질문 · 답변                (폴더 감시)
```

Claude Code는 이벤트가 생길 때마다 훅 스크립트를 실행하면서 세션 정보를
stdin으로 넘겨줍니다. 훅은 거기 담긴 `transcript_path`로 대화 기록 끝부분을
훑어서 **채팅 제목 · 마지막 질문 · 마지막 답변**까지 뽑아 세션 파일에 적고,
앱은 그 폴더를 감시하다가 펫과 말풍선을 갱신합니다.

세션마다 파일을 따로 쓰기 때문에 VSCode와 터미널을 동시에 켜 둬도 상태가
섞이지 않습니다. 펫은 **가장 최근에 움직인 세션**을 따라가고, 여러 개가
돌고 있으면 말풍선 아래에 점이 뜹니다. 점을 누르면 세션을 전환합니다.

## 상태별 반응

| 상태 | 언제 | 펫 |
|------|------|-----|
| 대기 | `Stop`, `SessionStart` | 앉아서 눈 깜빡 |
| 생각 중 | `UserPromptSubmit` | 앉아서 고개 갸웃 |
| 작업 중 | `PreToolUse`, `PostToolUse` | 옆으로 총총 걷기 |
| 확인 필요 | `Notification` | 앞발 흔들기 |

## 설치

```bash
npm install
npm start
```

처음 켠 뒤 트레이 아이콘 우클릭 → **Claude Code 연동 설정**을 누르면
`~/.claude/settings.json`에 훅이 자동으로 등록됩니다.
직접 넣고 싶으면 [`settings-snippet.json`](settings-snippet.json)을 참고하세요.

> 이미 Claude Code가 켜져 있다면 훅을 등록한 뒤 다시 시작해야 적용됩니다.

## 트레이 메뉴

- **캐릭터** — `assets/characters/`에 있는 시트 중에서 고릅니다
- **크기** — 50% ~ 200%
- **위치 초기화** — 네 모서리 중 하나로 되돌립니다 (평소엔 펫을 끌어서 옮기면 됩니다)
- **Claude Code 연동 설정** — 훅 등록
- **캐릭터 폴더 열기**

## 폴더 구조

```
claude-pet/
├─ main.js                  # 창·트레이 관리, 세션 폴더 감시, 훅 등록
├─ preload.js               # 렌더러에 안전한 IPC API 노출
├─ renderer/
│   ├─ index.html
│   ├─ style.css            # 말풍선 · 펫 레이아웃
│   ├─ sprite.js            # 캐릭터 시트 애니메이터
│   └─ renderer.js          # 상태 → 화면 반영
├─ hooks/report-status.js   # Claude Code 훅이 실행하는 상태 기록 스크립트
├─ assets/characters/       # 캐릭터 시트(webp) + 프레임 좌표(json)
└─ tools/                   # 시트에서 프레임 격자를 뽑아내는 개발용 도구
```

## 캐릭터 추가하기

캐릭터는 **시트 이미지 한 장 + 프레임 좌표 JSON**으로 이루어집니다.
JSON은 원본 이미지를 자르지 않고 좌표만 담기 때문에 화질 손실이 없습니다.

```bash
# 1. 시트를 넣는다
cp 내시트.webp assets/characters/mydog-sheet.webp

# 2. tools/analyze-sheet.html, tools/preview-rows.html 안의
#    SHEET 상수를 방금 넣은 파일명으로 고친다

# 3. 알파 채널을 보고 프레임 격자를 자동으로 찾는다
env -u ELECTRON_RUN_AS_NODE npx electron tools/analyze-sheet.js

# 4. 어떤 행이 어떤 동작인지 눈으로 확인한다
env -u ELECTRON_RUN_AS_NODE npx electron tools/preview-rows.js

# 5. 캐릭터ID·표시이름·시트파일명을 넣어 JSON을 만든다
node tools/build-sheet-json.js mydog 마이독 mydog-sheet.webp
```

행 구성이 지금까지 받은 시트들과 다르면 `tools/build-sheet-json.js`의
`CLIPS`/`STATES` 상수도 손봐야 합니다.

행마다 프레임 수와 크기가 달라도 됩니다. 프레임은 **아래-가운데** 기준으로
정렬되므로 앉은 자세와 선 자세의 키 차이가 자연스럽게 유지됩니다.

앱 안에서 이 과정을 처리하는 설정 창은 아직 없습니다 — [TODO.md](TODO.md) 참고.

## 남은 작업

[TODO.md](TODO.md)에 정리해 두었습니다.

## 라이선스

MIT. 단, `assets/characters/`의 캐릭터 시트는 별도 저작물입니다.
