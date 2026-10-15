/** The face-outline glyph from the artboards' primary button; decorative, the label says it all. */
export function PasskeyIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M7 9 Q7 4 12 4 Q17 4 17 9 M5 12 Q5 7 12 7 Q19 7 19 12 Q19 16 17 20 M9 12 Q9 9 12 9 Q15 9 15 12 Q15 17 12 20 M12 13 Q12 16 10 19"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
