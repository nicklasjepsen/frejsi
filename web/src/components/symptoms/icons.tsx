import type { SymptomKind } from "@frejsi/shared";

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * The six kind pictures (plan §8: drawn like the food symbols, stroke currentColor on a 24-unit
 * grid, legible at 32 px) and a heart for a space's own kinds. `aria-hidden`: the tile carries
 * the name.
 */
export function SymptomIcon({ kind, size = 40 }: { kind: SymptomKind; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", "aria-hidden": true as const };
  switch (kind) {
    case "stomach-ache":
      return (
        <svg {...common} data-kind={kind}>
          <path d="M7 4 Q4 8 5 13 Q6 19 12 20 Q18 19 19 13 Q20 8 17 4" {...STROKE} />
          <path d="M8 12 Q10 10 12 12 Q14 14 16 12" {...STROKE} />
          <path d="M8 15.5 Q10 13.5 12 15.5 Q14 17.5 16 15.5" {...STROKE} />
        </svg>
      );
    case "dizzy":
      return (
        <svg {...common} data-kind={kind}>
          <circle cx="12" cy="13" r="8" {...STROKE} />
          <path d="M8 11 L10 13 M10 11 L8 13 M14 11 L16 13 M16 11 L14 13" {...STROKE} />
          <path d="M9.5 17 Q12 15.5 14.5 17" {...STROKE} />
          <path d="M17 5 L18 3 L19 5 L21 6 L19 7 L18 9 L17 7 L15 6 Z" fill="currentColor" />
        </svg>
      );
    case "nausea":
      return (
        <svg {...common} data-kind={kind}>
          <circle cx="12" cy="12" r="8.5" {...STROKE} />
          <path d="M8.5 10 L10.5 10 M13.5 10 L15.5 10" {...STROKE} />
          <path d="M8 15.5 Q9.5 14 11 15.5 Q12.5 17 14 15.5 Q15 14.5 16 15.5" {...STROKE} />
        </svg>
      );
    case "tired":
      return (
        <svg {...common} data-kind={kind}>
          <circle cx="11" cy="13" r="8" {...STROKE} />
          <path d="M7.5 12 Q9 13.5 10.5 12 M11.5 12 Q13 13.5 14.5 12" {...STROKE} />
          <path d="M9 16.5 L13 16.5" {...STROKE} />
          <path d="M16 4 L20 4 L16 8 L20 8" {...STROKE} strokeWidth="1.6" />
        </svg>
      );
    case "headache":
      return (
        <svg {...common} data-kind={kind}>
          <path d="M7 20 V16 Q4 13 4 10 A8 8 0 0 1 20 10 Q20 13 17 16 V20" {...STROKE} />
          <path d="M8 9 L10 7 L12 9 L14 7 L16 9" {...STROKE} />
          <path d="M9 13 L11 11 L13 13 L15 11" {...STROKE} />
        </svg>
      );
    case "shaky":
      return (
        <svg {...common} data-kind={kind}>
          <path d="M9 20 V9 Q9 7 11 7 Q13 7 13 9 V13 M13 9 Q13 7 15 7 Q17 7 17 9 V14 Q17 20 12 20 Q10 20 9 19" {...STROKE} />
          <path d="M4 9 L6 9 M4 13 L6 13 M20 10 L22 10 M20 14 L22 14" {...STROKE} />
        </svg>
      );
    default:
      return (
        <svg {...common} data-kind="custom">
          <path d="M12 20 L5 13 A4 4 0 0 1 12 7 A4 4 0 0 1 19 13 Z" {...STROKE} />
        </svg>
      );
  }
}

/** "Jeg har det…" in the desktop sidebar: a small heart on the 26-unit nav grid. */
export function FeelIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <path
        d="M13 22 L5 14 A4.5 4.5 0 0 1 13 7.5 A4.5 4.5 0 0 1 21 14 Z"
        {...STROKE}
        strokeWidth="2.2"
      />
    </svg>
  );
}
