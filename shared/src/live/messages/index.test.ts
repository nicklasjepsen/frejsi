import { describe, expect, it } from "vitest";

import da from "./da.json";
import en from "./en.json";
import { formatLiveAge, formatLiveValue, liveAlertText, liveRestartText } from "./index";

describe("the relay's alert copy", () => {
  it("is the contract's low line in Danish and English, value with its age", () => {
    expect(
      liveAlertText("da", { kind: "low", mgdl: 65, unit: "mmolL", ageMs: 2 * 60_000 }).title,
    ).toBe("Lav: 3,6 mmol/L · 2 min siden");
    expect(
      liveAlertText("en", { kind: "low", mgdl: 65, unit: "mmolL", ageMs: 150_000 }).title,
    ).toBe("Low: 3.6 mmol/L · 2 min ago");
  });

  it("writes mg/dL as a whole number and a fresh reading as just now", () => {
    expect(
      liveAlertText("en", { kind: "high", mgdl: 250, unit: "mgdL", ageMs: 20_000 }).title,
    ).toBe("High: 250 mg/dL · just now");
    expect(liveAlertText("da", { kind: "high", mgdl: 250, unit: "mgdL", ageMs: 0 }).title).toBe(
      "Høj: 250 mg/dL · lige nu",
    );
  });

  it("names the minutes in the no-new-readings alert, and every alert says it is a reminder", () => {
    const da20 = liveAlertText("da", { kind: "stale", ageMs: 20 * 60_000 + 5_000 });
    expect(da20.title).toBe("Ingen nye målinger i 20 min");
    expect(da20.body).toContain("CGM");
    expect(liveAlertText("en", { kind: "stale", ageMs: 23 * 60_000 }).title).toBe(
      "No new readings for 23 min",
    );
  });

  it("formats values and ages on their own", () => {
    expect(formatLiveValue(100, "mmolL", "da")).toBe("5,6");
    expect(formatLiveValue(100, "mmolL", "en")).toBe("5.6");
    expect(formatLiveAge(-5_000, "en")).toBe("just now");
    expect(formatLiveAge(61_000, "da")).toBe("1 min siden");
    expect(liveRestartText("da")).toEqual({ title: "Live Activity", body: "Startet igen" });
  });

  it("has the same keys in both languages", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      typeof value === "object" && value !== null
        ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
        : [prefix];
    expect(keys(da)).toEqual(keys(en));
  });
});
