// What the curve's tooltip points at (issue 243): the reading nearest the pointer in time, or a
// marker within a few pixels of it, or on the meal curve an earlier occurrence lying nearer than
// this one. Pure and in viewBox units, so the hit rules are tested as numbers.
import type { Trend } from "@frejsi/shared/schemas/index";

/** A reading the curve draws, at its place in the viewBox. `trend` is null on the week tile. */
export interface TipPoint {
  ts: string;
  mmol: number;
  trend: Trend | null;
  x: number;
  y: number;
}

/**
 * A marker the tooltip can name: a meal line spans the plot (`y` null), a symptom or bolus sits on
 * the baseline at `y`. `name` is the marker's own accessible name: a time, never a reading.
 */
export interface TipMark {
  id: string;
  x: number;
  y: number | null;
  name: string;
}

/** An earlier occurrence on the meal curve, named by its date, never by a value. */
export interface TipPrevious {
  name: string;
  points: readonly { x: number; y: number }[];
}

export type TipHit =
  | { kind: "mark"; mark: TipMark }
  | { kind: "reading"; index: number }
  | { kind: "previous"; curve: number; x: number; y: number };

/** How close, in screen pixels, the pointer must be to a marker for the tooltip to name it. */
export const MARK_PX = 6;
/** How far above or below the baseline a marker on it still counts. */
const BASELINE_PX = 12;
/** How close an earlier curve must be, vertically, to be named instead of this one. */
const PREVIOUS_PX = 8;

/** The index of the point nearest `x` (points sorted by x), or -1 when there is none. */
export function nearestIndex(points: readonly { x: number }[], x: number): number {
  let best = -1;
  let distance = Infinity;
  points.forEach((point, index) => {
    const d = Math.abs(point.x - x);
    if (d < distance) {
      best = index;
      distance = d;
    }
  });
  return best;
}

/**
 * What lies under the pointer at (`x`, `y`) in the viewBox; `sx` and `sy` are viewBox units per
 * screen pixel. A marker wins over a reading, so the meal line names the meal.
 */
export function hitAt(input: {
  x: number;
  y: number;
  sx: number;
  sy: number;
  points: readonly TipPoint[];
  marks: readonly TipMark[];
  previous: readonly TipPrevious[];
}): TipHit | null {
  const { x, y, sx, sy } = input;
  let mark: TipMark | null = null;
  let markDistance = MARK_PX * sx;
  for (const candidate of input.marks) {
    const d = Math.abs(candidate.x - x);
    const onIt = candidate.y === null || Math.abs(candidate.y - y) <= BASELINE_PX * sy;
    if (onIt && d <= markDistance) {
      mark = candidate;
      markDistance = d;
    }
  }
  if (mark) return { kind: "mark", mark };

  const index = nearestIndex(input.points, x);
  const own = input.points[index];
  const ownDistance = own ? Math.abs(own.y - y) : Infinity;
  let previous: Extract<TipHit, { kind: "previous" }> | null = null;
  let previousDistance = Math.min(PREVIOUS_PX * sy, ownDistance);
  for (const [i, curve] of input.previous.entries()) {
    const near = curve.points[nearestIndex(curve.points, x)];
    if (!near || Math.abs(near.x - x) > MARK_PX * 2 * sx) continue;
    const d = Math.abs(near.y - y);
    if (d < previousDistance) {
      previous = { kind: "previous", curve: i, x: near.x, y: near.y };
      previousDistance = d;
    }
  }
  if (previous) return previous;
  return own ? { kind: "reading", index } : null;
}

/** Which way the tooltip opens from the guide, so it stays inside the chart at both edges. */
export function tipAnchor(x: number, width: number): "start" | "middle" | "end" {
  if (x < width * 0.2) return "start";
  if (x > width * 0.8) return "end";
  return "middle";
}
