// The QR code behind an invitation link, as a module matrix and an SVG path. The encoder is the
// `qrcode` package; this module only reads its matrix, so the drawing is one `<path>` (QrCode:
// 96 px square, black on white in every theme, Personer-Desktop).
import { create } from "qrcode";

export interface QrModules {
  size: number;
  /** `modules[row][col]` is true for a dark module. */
  modules: boolean[][];
}

/** Error correction M: the link is short and the code is scanned from a screen. */
export function qrModules(text: string): QrModules {
  const code = create(text, { errorCorrectionLevel: "M" });
  const { size } = code.modules;
  const modules: boolean[][] = [];
  for (let row = 0; row < size; row++) {
    const line: boolean[] = [];
    for (let col = 0; col < size; col++) line.push(code.modules.get(row, col) === 1);
    modules.push(line);
  }
  return { size, modules };
}

/** One unit square per dark module, offset by `quietZone` modules on each side. */
export function qrPath(modules: boolean[][], quietZone: number): string {
  const parts: string[] = [];
  modules.forEach((line, row) => {
    line.forEach((dark, col) => {
      if (dark) parts.push(`M${col + quietZone} ${row + quietZone}h1v1h-1z`);
    });
  });
  return parts.join("");
}
