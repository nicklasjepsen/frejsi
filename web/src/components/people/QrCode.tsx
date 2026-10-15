import { useMemo } from "react";

import { qrModules, qrPath } from "./qr";

/** The standard's quiet zone: four light modules around the symbol. */
const QUIET_ZONE = 4;

/**
 * An invitation's QR code as inline SVG in the current text colour, with the quiet zone inside the
 * viewBox so it scans against any surface. `label` is what a screen reader says; the link itself
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
      <path d={d} fill="currentColor" />
    </svg>
  );
}
