import type { NavIcon } from "./nav";

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** The nav icons from the artboards: inline SVG, stroke currentColor, 26 px grid. */
export function Icon({ name, size = 26 }: { name: NavIcon; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 26 26", "aria-hidden": true as const };
  switch (name) {
    case "now":
      return (
        <svg {...common}>
          <circle cx="13" cy="13" r="9" {...STROKE} strokeWidth="2.2" />
          <circle cx="13" cy="13" r="3" fill="currentColor" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M13 5 V21 M5 13 H21" {...STROKE} strokeWidth="2.2" />
        </svg>
      );
    case "book":
      return (
        <svg {...common}>
          <path
            d="M5 6 H12 Q13 6 13 7 V21 Q13 20 12 20 H5 Z M21 6 H14 Q13 6 13 7 V21 Q13 20 14 20 H21 Z"
            {...STROKE}
            strokeWidth="2"
          />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="13" cy="13" r="9" {...STROKE} strokeWidth="2.2" />
          <path d="M13 8 V13 L16.5 15.5" {...STROKE} strokeWidth="2.2" />
        </svg>
      );
    case "dots":
      return (
        <svg {...common}>
          <circle cx="6" cy="13" r="2" fill="currentColor" />
          <circle cx="13" cy="13" r="2" fill="currentColor" />
          <circle cx="20" cy="13" r="2" fill="currentColor" />
        </svg>
      );
    case "people":
      return (
        <svg {...common}>
          <circle cx="10" cy="9" r="4" {...STROKE} strokeWidth="2" />
          <path d="M3 21 Q3 14 10 14 Q17 14 17 21" {...STROKE} strokeWidth="2" />
          <circle cx="18" cy="9" r="3" {...STROKE} strokeWidth="2" />
          <path d="M19 14 Q23 15 23 20" {...STROKE} strokeWidth="2" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="13" cy="13" r="3.5" {...STROKE} strokeWidth="2" />
          <path
            d="M13 3 V7 M13 19 V23 M3 13 H7 M19 13 H23 M6 6 L9 9 M17 17 L20 20 M6 20 L9 17 M17 9 L20 6"
            {...STROKE}
            strokeWidth="2"
          />
        </svg>
      );
    case "ask":
      return (
        <svg {...common}>
          <circle cx="13" cy="13" r="9" {...STROKE} strokeWidth="2.4" />
          <path
            d="M10.5 10.5 Q13 7.5 15.5 10.5 Q15.5 12.5 13 14 V15.5 M13 18 V18.3"
            {...STROKE}
            strokeWidth="2.4"
          />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="4" y="6" width="18" height="16" rx="3" {...STROKE} strokeWidth="2" />
          <path d="M4 11 H22 M9 4 V8 M17 4 V8" {...STROKE} strokeWidth="2" />
        </svg>
      );
  }
}

export function ChevronIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      <path d="M7 4 L12 9 L7 14" {...STROKE} strokeWidth="1.8" />
    </svg>
  );
}
