import { describe, expect, it } from "vitest";

import { FakeFoodContributor } from "./fake-contributor";

const correction = { barcode: "2000000000008", carbsPer100g: 40, appRef: "a" };

describe("FakeFoodContributor", () => {
  it("answers ok by default and records every correction", async () => {
    const fake = new FakeFoodContributor();
    expect(fake.id).toBe("off");
    expect(await fake.contribute(correction, new AbortController().signal)).toEqual({
      status: "ok",
    });
    expect(fake.corrections).toEqual([correction]);
  });
  it("answers from its script and repeats the last entry", async () => {
    const fake = new FakeFoodContributor({ script: ["rejected", "ok"] });
    const signal = new AbortController().signal;
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await fake.contribute(correction, signal)).status);
    expect(statuses).toEqual(["rejected", "ok", "ok"]);
    expect(fake.corrections).toHaveLength(3);
  });
  it("answers error for an aborted signal", async () => {
    const fake = new FakeFoodContributor();
    expect(await fake.contribute(correction, AbortSignal.abort())).toEqual({ status: "error" });
  });
});
