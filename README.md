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

## 모션(클립) 목록과 우선순위

시트에는 11개 동작이 있고, 상태 하나에 동작 하나를 고정하지 않습니다.
매 순간 `renderer/renderer.js`의 `updateClip()`이 아래 우선순위대로
"지금 뭘 보여줄지"를 다시 계산합니다. 위에 있을수록 우선합니다.

| 우선순위 | 클립 | 언제 나오나 |
|---|---|---|
| 1 (가장 우선) | `walkRight` / `walkLeft` | 펫을 클릭해서 드래그로 옮기는 동안, 끄는 방향으로 |
| 2 | `jump` | 답변이 막 도착한 직후 3.5초간 |
| 3 (평소 상태) | `sulky` | 토큰(사용량) 한도에 도달했을 때만. `Notification` 문구가 한도 도달로 읽힐 때 훅이 내부적으로 `limit` 상태로 표시한다 |
| 3 | `wave` | Claude Code가 `Notification`(그 외 확인 필요) 상태일 때 |
| 3 | `ponder` | `UserPromptSubmit`(생각 중) 상태일 때 |
| 3 | `working` | `PreToolUse`/`PostToolUse`(작업 중) 상태일 때 |
| 3 | `idle` (+가끔 `poke`) | 돌아가는 세션이 없거나(`none`) 대기 상태(`Stop`/`SessionStart`)일 때. 20~40초마다 한 번씩 `poke`(앞발로 건드리기)를 1.5초 끼워 넣는다 — **할 일이 없는 것과 시무룩할 이유는 다르므로, 세션이 아예 없어도 그냥 idle로 쉰다** |

즉 "드래그 중"과 "답변 도착"은 잠깐 끼어드는 연출이라 다른 무엇보다
우선하고, 그것도 아니면 지금 Claude Code 상태 그대로를 보여줍니다.
1~2순위가 끝나면 3순위(원래 상태)로 자연히 돌아옵니다.

> 예전엔 마우스가 펫 근처에 오면 그쪽으로 시선을 돌리는 `lookRight`/`lookLeft`
> 정지 프레임 모션이 있었는데, 실제 마우스 각도와 눈이 보는 방향이 안 맞아
> 어색해서 통째로 없앴습니다.

## 말풍선

- **첫째 줄**: Claude가 붙인 채팅 제목(없으면 최근 답변/질문 요약)
- **둘째 줄**: 지금 상황에 따라 바뀝니다 — 생각 중 / 작업 중 / 명령어 쓰는 중 /
  질문하는 중 / 확인해 주세요! / 답변이 막 도착했으면 `✅ <답변 마지막 문장>`.
  처리 중인 게 없으면 비웁니다.
- **말풍선을 누르면** 그 대화가 돌아가는 화면(VSCode/터미널)으로 포커스를
  옮기려 시도합니다 (Windows 전용, cwd 폴더 이름으로 창 제목을 찾는
  방식이라 터미널은 제목에 폴더명이 없으면 못 찾을 수 있습니다).
- 답변이 막 도착했는데 그 화면이 아직 포커스가 아니면, 돌아올 때까지
  말풍선을 계속 띄워 둡니다. 우측 상단 **×** 버튼으로 그 자리에서 한 번만
  닫을 수 있고(일회성), 다음 상태 변화가 오면 다시 정상적으로 뜹니다.

## 설치

```bash
npm install
npm start
```

처음 켠 뒤 트레이 아이콘 우클릭 → **Claude Code 연동 설정**을 누르면
`~/.claude/settings.json`에 훅이 자동으로 등록됩니다.
직접 넣고 싶으면 [`settings-snippet.json`](settings-snippet.json)을 참고하세요.

> 이미 Claude Code가 켜져 있다면 훅을 등록한 뒤 다시 시작해야 적용됩니다.

연동 설정을 한 번 해두면, 그다음부터는 **Claude Code를 켤 때(`SessionStart`)
펫이 안 떠 있으면 자동으로 실행**됩니다 — `npm start`를 매번 직접 칠 필요가
없습니다. (앱을 실행할 때마다 `~/.claude-pet/launch-info.json`에 실행 파일
경로를 적어 두고, 훅이 그걸 보고 다시 띄웁니다. 이미 떠 있으면 조용히 무시됩니다.)

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

# 4-1. 헷갈리는 행이 있으면 하나만 크게 확대해서 본다 (선택)
env -u ELECTRON_RUN_AS_NODE npx electron tools/zoom-row.js 4

# 5. 캐릭터ID·표시이름·시트파일명을 넣어 JSON을 만든다
node tools/build-sheet-json.js mydog 마이독 mydog-sheet.webp
```

행 구성이 지금까지 받은 시트들과 다르면 `tools/build-sheet-json.js`의
`CLIPS`/`STATES` 상수도 손봐야 합니다. **자세만 보고 이름을 추측하지
말고, 실제로 만든 사람에게 각 행의 의도를 확인하는 게 안전합니다** — 처음
몽이 시트를 넣을 때 자세만 보고 붙인 이름이 실제 의도와 달랐던 적이 있어서,
지금 이름들은 전부 만든 사람에게 직접 확인받은 것입니다.

행마다 프레임 수와 크기가 달라도 됩니다. 프레임은 **아래-가운데** 기준으로
정렬되므로 앉은 자세와 선 자세의 키 차이가 자연스럽게 유지됩니다.

앱 안에서 이 과정을 처리하는 설정 창은 아직 없습니다 — [TODO.md](TODO.md) 참고.

## 남은 작업

[TODO.md](TODO.md)에 정리해 두었습니다.

## 라이선스

MIT. 단, `assets/characters/`의 캐릭터 시트는 별도 저작물입니다.
