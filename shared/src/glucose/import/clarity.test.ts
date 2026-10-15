import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { Reading } from "../../schemas/glucose";
import { clarityImport } from "./clarity";
import { GLUCOSE_IMPORT_SOURCES, parseGlucoseImport } from "./registry";
import { GlucoseImportError } from "./types";

const fixtures = path.resolve(import.meta.dirname, "../../../../fixtures/clarity");
const fixture = (name: string) => readFileSync(path.join(fixtures, name), "utf8");
const copenhagen = { timezone: "Europe/Copenhagen" };

describe("Dexcom Clarity import (#154)", () => {
  it("is the registered format and recognises its header, in mmol/L, mg/dL and with semicolons", () => {
    expect(GLUCOSE_IMPORT_SOURCES.map((s) => s.format)).toEqual(["clarity"]);
    for (const name of [
      "clarity-export-mmol.csv",
      "clarity-export-mgdl.csv",
      "clarity-export-semicolon.csv",
      "clarity-export-da.csv",
    ]) {
      expect(clarityImport.detect(fixture(name)), name).toBe(true);
    }
    expect(clarityImport.detect("name,carbs\nrye bread,41\n")).toBe(false);
    expect(clarityImport.detect("")).toBe(false);
    expect(clarityImport.detect("﻿" + fixture("clarity-export-mmol.csv"))).toBe(true);
  });

  it("reads every EGV row as a reading in UTC with the sensor's arrow, oldest first, one per instant", () => {
    const parsed = clarityImport.parse(fixture("clarity-export-mmol.csv"), copenhagen);
    expect(parsed.format).toBe("clarity");
    expect(parsed.readings).toHaveLength(10);
    for (const reading of parsed.readings) expect(Reading.safeParse(reading).success).toBe(true);
    expect(parsed.readings[0]).toEqual({
      ts: "2026-10-14T05:00:12.000Z",
      mmol: 6.4,
      trend: "flat",
    });
    expect(parsed.readings[2]).toEqual({
      ts: "2026-10-14T05:10:12.000Z",
      mmol: 7.1,
      trend: "forty-five-up",
    });
    expect(parsed.readings[4]).toMatchObject({ mmol: 8.8, trend: "double-up" });
    expect(parsed.readings[7]).toMatchObject({ mmol: 9.0, trend: "forty-five-down" });
    expect(parsed.readings.at(-1)).toMatchObject({ mmol: 8.2, trend: "double-down" });
    const times = parsed.readings.map((r) => Date.parse(r.ts));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(times.length);
  });

  it("maps Low and High to the sensor's range and a missing rate to not-computable", () => {
    const parsed = clarityImport.parse(fixture("clarity-export-mmol.csv"), copenhagen);
    expect(parsed.readings[5]).toEqual({
      ts: "2026-10-14T05:25:12.000Z",
      mmol: 22.2,
      trend: "not-computable",
    });
    expect(parsed.readings[8]).toEqual({
      ts: "2026-10-14T05:40:12.000Z",
      mmol: 2.2,
      trend: "not-computable",
    });
  });

  it("reads the carb entries as carbs with their time", () => {
    const parsed = clarityImport.parse(fixture("clarity-export-mmol.csv"), copenhagen);
    expect(parsed.carbs).toEqual([
      { ts: "2026-10-14T05:12:00.000Z", grams: 35 },
      { ts: "2026-10-14T10:30:00.000Z", grams: 50 },
    ]);
  });

  it("counts every other row and keeps nothing of it: no dosing row, value or word survives the parse", () => {
    const text = fixture("clarity-export-mmol.csv");
    expect(text).toContain("Insulin");
    const parsed = clarityImport.parse(text, copenhagen);
    // Patient (3), device (1), alerts (4), the two dosing rows, exercise, calibration, health.
    expect(parsed.otherRows).toBe(13);
    const json = JSON.stringify(parsed).toLowerCase();
    for (const word of ["insulin", "fast-acting", "long-acting", "4.5", "12,", "alma", "example"]) {
      expect(json, word).not.toContain(word);
    }
    expect(Object.keys(parsed).sort()).toEqual(["carbs", "format", "otherRows", "readings"]);
  });

  it("converts an mg/dL export, with the space-separated, non-padded timestamp", () => {
    const parsed = clarityImport.parse(fixture("clarity-export-mgdl.csv"), {
      timezone: "America/New_York",
    });
    expect(parsed.readings).toEqual([
      { ts: "2026-10-14T11:00:12.000Z", mmol: 6.4, trend: "flat" },
      { ts: "2026-10-14T11:05:12.000Z", mmol: 6.9, trend: "forty-five-up" },
      { ts: "2026-10-14T11:10:12.000Z", mmol: 22.2, trend: "not-computable" },
    ]);
    expect(parsed.carbs).toEqual([{ ts: "2026-10-14T11:11:00.000Z", grams: 20 }]);
    expect(parsed.otherRows).toBe(4);
  });

  it("reads a semicolon-separated export with comma decimals", () => {
    const parsed = clarityImport.parse(fixture("clarity-export-semicolon.csv"), copenhagen);
    expect(parsed.readings).toEqual([
      { ts: "2026-10-14T05:00:12.000Z", mmol: 6.4, trend: "flat" },
      { ts: "2026-10-14T05:05:12.000Z", mmol: 6.6, trend: "flat" },
    ]);
    expect(parsed.carbs).toEqual([{ ts: "2026-10-14T05:12:00.000Z", grams: 35 }]);
  });

  it("reads a Danish-locale export: quoted fields, BOM, CRLF, Danish headers and event types (#155)", () => {
    const text = fixture("clarity-export-da.csv");
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text).toContain("\r\n");
    expect(clarityImport.detect(text)).toBe(true);
    const parsed = parseGlucoseImport(text, copenhagen);
    expect(parsed.format).toBe("clarity");
    expect(parsed.readings).toEqual([
      { ts: "2026-10-14T05:00:12.000Z", mmol: 6.4, trend: "not-computable" },
      { ts: "2026-10-14T05:05:12.000Z", mmol: 7.1, trend: "single-up" },
      { ts: "2026-10-14T05:15:12.000Z", mmol: 22.2, trend: "not-computable" },
      { ts: "2026-10-14T05:20:12.000Z", mmol: 2.2, trend: "not-computable" },
      { ts: "2026-10-14T05:25:12.000Z", mmol: 5.8, trend: "not-computable" },
    ]);
    expect(parsed.carbs).toEqual([{ ts: "2026-10-14T05:12:00.000Z", grams: 35 }]);
    // Patient (3), device (2), alerts (7), the reading without a value and the dosing row.
    expect(parsed.otherRows).toBe(14);
  });

  it("keeps nothing of a Danish export's other rows: no dosing row, value or word survives", () => {
    const text = fixture("clarity-export-da.csv");
    expect(text).toContain('"Insulin"');
    const parsed = clarityImport.parse(text, copenhagen);
    const json = JSON.stringify(parsed).toLowerCase();
    for (const word of [
      "insulin",
      "3,5",
      "3.5",
      "alma",
      "example",
      "advisering",
      "fødselsdato",
      "2016",
    ]) {
      expect(json, word).not.toContain(word);
    }
    expect(Object.keys(parsed).sort()).toEqual(["carbs", "format", "otherRows", "readings"]);
  });

  it("matches headers case-insensitively and refuses a Danish header without the glucose column", () => {
    const text = fixture("clarity-export-da.csv");
    expect(clarityImport.detect(text.replace("Hændelsestype", "HÆNDELSESTYPE"))).toBe(true);
    expect(clarityImport.detect(text.replace("Glukoseværdi (mmol/L)", "Glukose"))).toBe(false);
  });

  it("places the wall-clock times in the space's timezone", () => {
    const utc = clarityImport.parse(fixture("clarity-export-mmol.csv"), { timezone: "UTC" });
    expect(utc.readings[0]?.ts).toBe("2026-10-14T07:00:12.000Z");
  });

  it("refuses a file that is not a Clarity export, and an export with nothing to import", () => {
    expect(() => parseGlucoseImport("name,carbs\nrye bread,41\n", copenhagen)).toThrow(
      new GlucoseImportError("import-unrecognised"),
    );
    const headerOnly = fixture("clarity-export-mmol.csv").split("\n").slice(0, 9).join("\n");
    expect(() => parseGlucoseImport(headerOnly, copenhagen)).toThrow(
      new GlucoseImportError("import-empty"),
    );
    // A glucose column without a unit is not something to guess about.
    const noUnit = fixture("clarity-export-mmol.csv").replace("Glucose Value (mmol/L)", "Glucose");
    expect(() => parseGlucoseImport(noUnit, copenhagen)).toThrow(
      new GlucoseImportError("import-unrecognised"),
    );
  });

  it("skips a reading whose time or value cannot be read rather than refusing the file", () => {
    const text = fixture("clarity-export-mgdl.csv").replace("2026-10-14 7:00:12", "yesterday");
    const parsed = clarityImport.parse(text, copenhagen);
    expect(parsed.readings).toHaveLength(2);
    expect(parsed.otherRows).toBe(5);
  });
});
