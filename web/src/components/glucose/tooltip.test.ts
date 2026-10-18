import { describe, expect, it } from "vitest";

import { hitAt, nearestIndex, tipAnchor, type TipMark, type TipPoint } from "./tooltip";

const point = (x: number, y: number, minute: number): TipPoint => ({
  ts: new Date(Date.UTC(2026, 9, 15, 12, minute)).toISOString(),
  mmol: 6,
  trend: "flat",
  x,
  y,
});
const points = [point(0, 50, 0), point(10, 40, 5), point(20, 30, 10), point(30, 20, 15)];
const meal: TipMark = { id: "meal", x: 14, y: null, name: "Måltid kl. 14:10" };
const symptom: TipMark = { id: "s", x: 26, y: 100, name: "Ondt i maven kl. 14:15" };

describe("nearestIndex", () => {
  it("snaps to the reading nearest in x, and gives -1 for an empty curve", () => {
    expect(nearestIndex(points, -5)).toBe(0);
    expect(nearestIndex(points, 4.9)).toBe(0);
    expect(nearestIndex(points, 5.1)).toBe(1);
    expect(nearestIndex(points, 26)).toBe(3);
    expect(nearestIndex(points, 99)).toBe(3);
    expect(nearestIndex([], 10)).toBe(-1);
  });
});

describe("hitAt", () => {
  const base = { sx: 1, sy: 1, points, marks: [meal, symptom], previous: [] };

  it("names the reading under the pointer when no marker is within a few pixels", () => {
    expect(hitAt({ ...base, x: 7, y: 0 })).toEqual({ kind: "reading", index: 1 });
  });

  it("names a meal line anywhere along its height, within a few pixels of it", () => {
    expect(hitAt({ ...base, x: 16, y: 5 })).toEqual({ kind: "mark", mark: meal });
    expect(hitAt({ ...base, x: 21, y: 5 })).toEqual({ kind: "reading", index: 2 });
  });

  it("names a marker on the baseline only near the baseline", () => {
    expect(hitAt({ ...base, x: 27, y: 96 })).toEqual({ kind: "mark", mark: symptom });
    expect(hitAt({ ...base, x: 27, y: 40 })).toEqual({ kind: "reading", index: 3 });
  });

  it("measures the few pixels on screen, not in the viewBox", () => {
    // Two viewBox units per pixel: 6 px is 12 units.
    expect(hitAt({ ...base, sx: 2, x: 25, y: 5 })).toEqual({ kind: "mark", mark: meal });
  });

  it("names an earlier curve when the pointer is nearer to it than to this one", () => {
    const previous = [{ name: "Tidligere gang, 8. oktober", points: [{ x: 10, y: 80 }] }];
    expect(hitAt({ ...base, marks: [], previous, x: 10, y: 78 })).toEqual({
      kind: "previous",
      curve: 0,
      x: 10,
      y: 80,
    });
    expect(hitAt({ ...base, marks: [], previous, x: 10, y: 45 })).toEqual({
      kind: "reading",
      index: 1,
    });
  });

  it("gives nothing on an empty curve with nothing marked", () => {
    expect(hitAt({ ...base, points: [], marks: [], x: 10, y: 10 })).toBeNull();
  });
});

describe("tipAnchor", () => {
  it("keeps the tooltip inside the chart at both edges", () => {
    expect(tipAnchor(5, 100)).toBe("start");
    expect(tipAnchor(50, 100)).toBe("middle");
    expect(tipAnchor(95, 100)).toBe("end");
  });
});
