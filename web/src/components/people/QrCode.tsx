import { useMemo } from "react";

import { qrModules, qrPath } from "./qr";

/** The standard's quiet zone: four light modules around the symbol. */
const QUIET_ZONE = 4;

/**
 * Fixed, not themed: a dark-mode surface would invert the code, and many camera scanners do not
 * read an inverted symbol. The code is black on its own white ground in every theme.
 */
const LIGHT = "#ffffff";
const DARK = "#000000";

/**
 * An invitation's QR code as inline SVG, black on white with the quiet zone drawn inside the
 * viewBox, so it scans against any surface in any theme. `label` is what a screen reader says; the link itself
 * is written next to it.
 */
export function QrCode({
  value,
  label,
  size = 96,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const { total, d } = useMemo(() => {
    const { size: modules, modules: matrix } = qrModules(value);
    return { total: modules + 2 * QUIET_ZONE, d: qrPath(matrix, QUIET_ZONE) };
  }, [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} fill={LIGHT} />
      <path d={d} fill={DARK} />
    </svg>
  );
}
