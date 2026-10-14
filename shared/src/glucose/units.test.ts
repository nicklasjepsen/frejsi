import { describe, expect, it } from "vitest";

import { fromMmol, mgdlToMmol, mmolToMgdl } from "./units";

describe("glucose units", () => {
  it("converts mg/dL to mmol/L with one decimal", () => {
    expect(mgdlToMmol(100)).toBe(5.6);
    expect(mgdlToMmol(180)).toBe(10);
    expect(mgdlToMmol(0)).toBe(0);
  });

  it("converts mmol/L to a whole mg/dL", () => {
    expect(mmolToMgdl(5.6)).toBe(101);
    expect(mmolToMgdl(10)).toBe(180);
  });

  it("renders the stored mmol value in the space's unit", () => {
    expect(fromMmol(6.2, "mmol")).toBe(6.2);
    expect(fromMmol(6.2, "mgdl")).toBe(112);
  });
});
