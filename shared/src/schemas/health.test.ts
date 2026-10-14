import { describe, expect, it } from "vitest";

import { Health } from "./health";

describe("Health", () => {
  it("is a coarse state: no timestamp and no value", () => {
    const valid = { ok: true, version: "v0.1.0", db: "ok", readings: "fresh" };
    expect(Health.parse(valid)).toEqual(valid);
    expect(Object.keys(Health.shape)).toEqual(["ok", "version", "db", "readings"]);
  });

  it("rejects a readings state it does not know", () => {
    expect(
      Health.safeParse({ ok: true, version: "v0.1.0", db: "ok", readings: "2026-10-15T08:00:00Z" })
        .success,
    ).toBe(false);
  });
});
