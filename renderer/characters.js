// 캐릭터 정의: 각 항목은 SVG 문자열을 반환하는 함수.
// class="eye"가 붙은 요소는 자동으로 깜빡임 애니메이션이 적용됩니다.
// pet-body / pet-body-shade / pet-accent 클래스는 CSS 변수(--pet-color 계열)로 채색됩니다.
window.PET_CHARACTERS = {
  robot: () => `
    <svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="60" cy="128" rx="26" ry="6" fill="#000" opacity="0.12"/>
      <rect class="pet-body-shade" x="30" y="18" width="10" height="22" rx="5"/>
      <circle class="pet-accent" cx="35" cy="14" r="6"/>
      <rect class="pet-body" x="18" y="36" width="84" height="66" rx="26"/>
      <rect class="pet-body-shade" x="18" y="80" width="84" height="22" rx="11" opacity="0.25"/>
      <rect class="pet-accent" x="30" y="52" width="60" height="32" rx="14"/>
      <circle class="eye left pet-face" cx="50" cy="68" r="6"/>
      <circle class="eye right pet-face" cx="72" cy="68" r="6"/>
      <rect class="pet-body" x="8" y="94" width="16" height="20" rx="8"/>
      <rect class="pet-body" x="96" y="94" width="16" height="20" rx="8"/>
    </svg>
  `,
  cat: () => `
    <svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="60" cy="128" rx="26" ry="6" fill="#000" opacity="0.12"/>
      <path class="pet-body" d="M20 40 L34 8 L46 38 Z"/>
      <path class="pet-body" d="M100 40 L86 8 L74 38 Z"/>
      <circle class="pet-body" cx="60" cy="70" r="46"/>
      <circle class="pet-accent" cx="60" cy="80" r="30"/>
      <circle class="eye left pet-face" cx="46" cy="70" r="6"/>
      <circle class="eye right pet-face" cx="74" cy="70" r="6"/>
      <path class="pet-face" d="M56 88 Q60 92 64 88" stroke="#10131a" stroke-width="3" fill="none" stroke-linecap="round"/>
      <line x1="16" y1="82" x2="38" y2="86" stroke="#10131a" stroke-width="2" opacity="0.5"/>
      <line x1="16" y1="92" x2="38" y2="92" stroke="#10131a" stroke-width="2" opacity="0.5"/>
      <line x1="104" y1="82" x2="82" y2="86" stroke="#10131a" stroke-width="2" opacity="0.5"/>
      <line x1="104" y1="92" x2="82" y2="92" stroke="#10131a" stroke-width="2" opacity="0.5"/>
    </svg>
  `,
  ghost: () => `
    <svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="60" cy="128" rx="24" ry="5" fill="#000" opacity="0.1"/>
      <path class="pet-body" d="M60 14 C30 14 18 38 18 66 L18 106
        C24 100 30 112 36 106 C42 100 48 112 54 106 C58 102 62 102 66 106
        C72 112 78 100 84 106 C90 112 96 100 102 106 L102 66
        C102 38 90 14 60 14 Z"/>
      <circle class="pet-accent" cx="60" cy="68" r="26" opacity="0.5"/>
      <circle class="eye left pet-face" cx="48" cy="64" r="6"/>
      <circle class="eye right pet-face" cx="72" cy="64" r="6"/>
      <ellipse class="pet-face" cx="60" cy="80" rx="5" ry="6"/>
    </svg>
  `,
  slime: () => `
    <svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="60" cy="128" rx="28" ry="6" fill="#000" opacity="0.12"/>
      <path class="pet-body" d="M60 24 C92 24 106 58 104 84
        C102 108 82 120 60 120 C38 120 18 108 16 84
        C14 58 28 24 60 24 Z"/>
      <ellipse class="pet-accent" cx="60" cy="52" rx="30" ry="16" opacity="0.55"/>
      <circle class="eye left pet-face" cx="46" cy="72" r="6"/>
      <circle class="eye right pet-face" cx="74" cy="72" r="6"/>
      <path class="pet-face" d="M52 88 Q60 94 68 88" stroke="#10131a" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle class="pet-accent" cx="30" cy="96" r="6" opacity="0.6"/>
      <circle class="pet-accent" cx="92" cy="100" r="4" opacity="0.6"/>
    </svg>
  `
};
