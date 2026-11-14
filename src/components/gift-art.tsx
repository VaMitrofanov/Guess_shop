import type { GiftTheme } from "@/lib/codes/gift";

/**
 * Атрибутика открыток (утверждённый мокап 14.11.2026): ДР — шарики и конфетти,
 * НГ — гирлянда, ёлки и снег, «Просто так» — коробка с бантом. Чистый SVG,
 * декоративный (`aria-hidden`); растягивается на всю шапку открытки.
 */
export default function GiftArt({ theme, className }: { theme: GiftTheme; className?: string }) {
  if (theme === "NEW_YEAR") {
    return (
      <svg className={className} viewBox="0 0 358 230" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path d="M0 16 Q 90 46 180 20 T 358 18" stroke="#2f6b3a" strokeWidth="3" fill="none" />
        <circle cx="30" cy="24" r="6" fill="#ff5a5a" /><circle cx="80" cy="32" r="6" fill="#ffd36b" /><circle cx="130" cy="30" r="6" fill="#45d6aa" />
        <circle cx="180" cy="20" r="6" fill="#ff8ad8" /><circle cx="230" cy="18" r="6" fill="#8cc8ff" /><circle cx="280" cy="22" r="6" fill="#ff5a5a" /><circle cx="330" cy="20" r="6" fill="#ffd36b" />
        <path d="M40 130 l20 36 h-11 l16 28 h-50 l16 -28 h-11 z" fill="#2fa36b" /><rect x="36" y="194" width="8" height="10" fill="#8a5a2b" />
        <path d="M40 122 l3 6 6 1 -4 4 1 6 -6 -3 -6 3 1 -6 -4 -4 6 -1 z" fill="#ffd36b" />
        <path d="M318 140 l16 30 h-9 l13 22 h-40 l13 -22 h-9 z" fill="#2fa36b" /><rect x="314" y="192" width="7" height="9" fill="#8a5a2b" />
        <g fill="#fff" opacity=".85"><circle cx="100" cy="80" r="2.5" /><circle cx="260" cy="70" r="2" /><circle cx="300" cy="110" r="3" /><circle cx="70" cy="100" r="2" /><circle cx="200" cy="200" r="2.5" /><circle cx="150" cy="190" r="2" /><circle cx="230" cy="160" r="2" /></g>
      </svg>
    );
  }
  if (theme === "JUST") {
    return (
      <svg className={className} viewBox="0 0 358 230" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <rect x="262" y="96" width="70" height="58" rx="5" fill="#fff" /><rect x="291" y="96" width="12" height="58" fill="#ff5a5a" />
        <rect x="254" y="84" width="86" height="18" rx="5" fill="#fff" /><rect x="291" y="84" width="12" height="18" fill="#ff5a5a" />
        <path d="M297 84 c-16 -20 -32 -4 0 0 c32 -4 16 -20 0 0" stroke="#ff5a5a" strokeWidth="4" fill="none" />
        <rect x="26" y="120" width="44" height="36" rx="4" fill="#fff" opacity=".9" /><rect x="44" y="120" width="8" height="36" fill="#7556e8" />
        <circle cx="40" cy="40" r="4" fill="#fff" /><circle cx="110" cy="190" r="3" fill="#fff" /><circle cx="330" cy="30" r="3" fill="#fff" />
        <rect x="200" y="22" width="6" height="12" rx="2" fill="#fff" transform="rotate(25 203 28)" /><rect x="150" y="200" width="5" height="10" rx="2" fill="#ffe08a" transform="rotate(-30 152 205)" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 358 230" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <ellipse cx="44" cy="44" rx="20" ry="25" fill="#ffd36b" /><path d="M44 69 q-6 16 4 34" stroke="#fff" strokeWidth="1.5" fill="none" />
      <ellipse cx="78" cy="30" rx="15" ry="19" fill="#45d6aa" /><path d="M78 49 q6 12 -2 26" stroke="#fff" strokeWidth="1.5" fill="none" />
      <ellipse cx="312" cy="40" rx="18" ry="22" fill="#ffffff" opacity=".9" /><path d="M312 62 q-5 14 3 30" stroke="#fff" strokeWidth="1.5" fill="none" />
      <ellipse cx="284" cy="58" rx="13" ry="16" fill="#ffd36b" />
      <rect x="120" y="22" width="6" height="12" rx="2" fill="#ffd36b" transform="rotate(20 123 28)" /><rect x="236" y="20" width="5" height="10" rx="2" fill="#45d6aa" transform="rotate(-30 238 25)" />
      <circle cx="200" cy="16" r="3.5" fill="#fff" /><circle cx="30" cy="150" r="3" fill="#ffd36b" />
      <rect x="330" y="140" width="5" height="10" rx="2" fill="#fff" transform="rotate(45 332 145)" /><circle cx="160" cy="190" r="2.5" fill="#fff" />
    </svg>
  );
}
