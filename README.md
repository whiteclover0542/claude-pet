# Claude Pet

Claude Code 작업 상태에 따라 반응하는 데스크톱 오버레이 펫입니다.
화면 한쪽 구석에 항상 떠 있으면서(Always on Top), Claude Code가
프롬프트를 처리하거나(생각 중) 도구를 실행하거나(작업 중) 사용자
확인이 필요할 때(알림) 캐릭터가 다르게 반응합니다.

## 폴더 구조

```
claude-pet/
├─ main.js              # Electron 메인 프로세스 (창 관리, 트레이, 훅 연동 설정)
├─ preload.js            # 렌더러에 안전한 IPC API 노출
├─ renderer/              # 펫이 그려지는 투명 오버레이 창
│   ├─ index.html
│   ├─ style.css          # 상태별 애니메이션 (idle/thinking/working/notify)
│   ├─ characters.js      # 캐릭터별 SVG (로봇/고양이/유령/슬라임)
│   └─ renderer.js
├─ hooks/report-status.js # Claude Code 훅이 호출하는 상태 기록 스크립트
└─ assets/icons/          # 트레이·앱 아이콘
```

실행 중에는 `~/.claude-pet/` 폴더에 아래 파일들이 생성됩니다.

- `config.json` — 캐릭터, 색상, 화면 위치 설정
- `status.json` — 현재 펫 상태 (Claude Code 훅이 갱신)
- `hooks/report-status.js` — 앱이 설치될 때 복사되는 훅 스크립트 실행 파일

## 1. 설치 및 실행

Node.js 18 이상이 필요합니다.

```bash
cd claude-pet
npm install
npm start
```

실행하면 화면 오른쪽 아래에 로봇 캐릭터가 떠 있는 창이 나타나고,
시스템 트레이에 Claude Pet 아이콘이 생깁니다.

## 2. 캐릭터 커스터마이징

트레이 아이콘을 우클릭하면 메뉴가 열립니다.

- **캐릭터**: 로봇 / 고양이 / 유령 / 슬라임 중 선택
- **색상**: 블루 / 퍼플 / 그린 / 오렌지 / 핑크 중 선택
- **위치**: 화면 네 모서리 중 선택

펫 창 자체를 마우스로 드래그해서 원하는 위치로 옮길 수도 있습니다.

새 캐릭터를 추가하려면 `renderer/characters.js`에 SVG 항목만
추가하고, `main.js`의 `characterItems` 배열과 라벨을 함께 갱신하면
됩니다.

## 3. Claude Code와 실제로 연동하기

트레이 메뉴에서 **"Claude Code 연동 설정"** 을 클릭하면
`~/.claude/settings.json`에 아래 훅들이 자동으로 추가됩니다
(이미 있는 설정은 덮어쓰지 않고 합쳐집니다).

| Claude Code 이벤트 | 펫 상태 변경 |
| --- | --- |
| `UserPromptSubmit` (프롬프트 제출 직후) | `thinking` (생각 중) |
| `PreToolUse` / `PostToolUse` (도구 실행 전/후) | `working` (작업 중) |
| `Notification` (권한 요청 등 사용자 확인 필요) | `notify` (알림, 통통 튀며 표시) |
| `Stop` (응답 완료) | `idle` (대기) |
| `SessionStart` / `SessionEnd` | `idle` (대기) |

각 훅은 `node ~/.claude-pet/hooks/report-status.js <state>` 형태로
실행되며, 상태를 `~/.claude-pet/status.json`에 기록합니다. Claude
Pet 앱은 이 파일을 0.3초 간격으로 감시하다가 변경되면 즉시
애니메이션을 갱신합니다.

수동으로 설정하고 싶다면 `settings-snippet.json`의 내용을
`~/.claude/settings.json`의 `hooks` 항목에 직접 병합해도 됩니다.
(단, `args`의 경로는 실제 홈 디렉터리 경로로 바꿔야 합니다.)

## 4. 설치 프로그램으로 배포하기

macOS(.dmg) / Windows(.exe, NSIS) / Linux(.AppImage) 설치 파일을
만들려면:

```bash
npm run dist
```

`electron-builder`가 각 OS에 맞는 설치 파일을 `dist/` 폴더에
생성합니다. 크로스 빌드(예: macOS에서 Windows 설치 파일 생성)는
추가 도구가 필요할 수 있으니, 가능하면 각 OS에서 직접 빌드하는
것을 권장합니다.

## 참고: Claude Code 훅 공식 문서

- Hooks reference: https://code.claude.com/docs/en/hooks
- Hooks 빠른 시작 가이드: https://code.claude.com/docs/en/hooks-guide

## 알려진 제한 사항

- macOS에서는 오버레이가 다른 창 위에 뜨도록 `floating` 레벨을
  사용합니다. 전체 화면 앱 위에서는 표시되지 않을 수 있습니다.
- Windows에서는 일부 전체 화면 게임/앱 위에 always-on-top 창이
  가려질 수 있습니다.
- 상태 연동은 로컬 Claude Code CLI 세션 기준입니다. Claude Code
  on the web(클라우드 세션)은 로컬 `~/.claude/settings.json`을
  읽지 않으므로 이 방식으로는 연동되지 않습니다.
