import { describe, expect, it } from "vitest";

import { readingsAround } from "./symptom-readings";

const T = "2026-10-14T12:30:00.000Z";
const at = (minutes: number) => new Date(new Date(T).getTime() + minutes * 60_000).toISOString();
const reading = (minutes: number, mmol: number) => ({
  ts: at(minutes),
  mmol,
  trend: "flat" as const,
});
const age = (ts: string) => `age(${ts.slice(11, 16)})`;

describe("readingsAround (v0.6.0 plan §5: the readings a symptom's detail shows)", () => {
  it("keeps those within 30 minutes either side, oldest first, each with its time, unit and age", () => {
    const out = readingsAround(
      T,
      [reading(35, 7.1), reading(10, 6.4), reading(-30, 5.9), reading(-31, 5.8), reading(30, 7)],
      "mmol",
      "da",
      "mmol/L",
      age,
    );
    expect(out).toEqual([
      { ts: at(-30), text: "5,9 mmol/L · age(12:00)" },
      { ts: at(10), text: "6,4 mmol/L · age(12:40)" },
      { ts: at(30), text: "7,0 mmol/L · age(13:00)" },
    ]);
  });

  it("formats mg/dL whole and in English, and drops a duplicated instant", () => {
    expect(
      readingsAround(T, [reading(0, 6.2), reading(0, 6.2)], "mgdl", "en", "mg/dL", age),
    ).toEqual([{ ts: at(0), text: "112 mg/dL · age(12:30)" }]);
  });

  it("is empty with no readings near", () => {
    expect(readingsAround(T, [reading(90, 6)], "mmol", "da", "mmol/L", age)).toEqual([]);
  });
});
