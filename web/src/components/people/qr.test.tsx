import "@testing-library/jest-dom/vitest";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { qrModules, qrPath } from "./qr";
import { QrCode } from "./QrCode";

const LINK = "https://frejsi.example/invite/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

describe("qrModules", () => {
  it("returns a square matrix with the finder pattern in the top-left corner", () => {
    const { size, modules } = qrModules(LINK);
    expect(size).toBeGreaterThanOrEqual(21);
    expect(size % 4).toBe(1);
    expect(modules).toHaveLength(size);
    for (const row of modules) expect(row).toHaveLength(size);
    // Finder: a 7×7 square whose outer ring is dark.
    expect(modules[0]?.slice(0, 7)).toEqual([true, true, true, true, true, true, true]);
    expect(modules[6]?.slice(0, 7)).toEqual([true, true, true, true, true, true, true]);
    expect(modules[1]?.slice(0, 7)).toEqual([true, false, false, false, false, false, true]);
    // The separator next to it is light.
    expect(modules[7]?.slice(0, 8).every((m) => !m)).toBe(true);
  });

  it("is deterministic for the same text and differs for another", () => {
    expect(qrModules(LINK)).toEqual(qrModules(LINK));
    expect(qrModules(`${LINK}x`)).not.toEqual(qrModules(LINK));
  });
});

describe("qrPath", () => {
  it("draws one unit square per dark module, offset by the quiet zone", () => {
    const { size, modules } = qrModules("frejsi");
    const path = qrPath(modules, 4);
    const squares = path.match(/M\d+ \d+h1v1h-1z/g) ?? [];
    const dark = modules.flat().filter(Boolean).length;
    expect(squares).toHaveLength(dark);
    expect(path.startsWith("M4 4h1v1h-1z")).toBe(true);
    expect(path).not.toContain(`M${size + 4} `);
  });
});

describe("QrCode", () => {
  it("renders an accessible SVG that scales with the quiet zone included", () => {
    const { container } = render(<QrCode value={LINK} label="Scan the invitation" size={96} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label", "Scan the invitation");
    expect(svg).toHaveAttribute("width", "96");
    const { size } = qrModules(LINK);
    expect(svg).toHaveAttribute("viewBox", `0 0 ${size + 8} ${size + 8}`);
    expect(container.querySelector("path")).toHaveAttribute("fill", "currentColor");
  });
});
