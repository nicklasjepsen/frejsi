import { describe, expect, it, vi } from "vitest";
import { foodContributors, foodSources } from "../registry";
import { FakeFoodContributor } from "../fake-contributor";
import { OffContributor } from "./contribute";
import { OffSource } from "./source";
import { FridaSource } from "../frida/source";

describe("configured food plugins", () => {
  it("registers both plugins but enables neither implicitly", () => {
    expect(foodSources({})).toEqual([]);
    const sources = foodSources({
      FOOD_SOURCES: "off,frida",
      OFF_COUNTRY: "dk",
      APP_VERSION: "test",
    });
    expect(sources.map((source) => [source.id, source.kind])).toEqual([
      ["off", "remote"],
      ["frida", "local"],
    ]);
    expect(sources[0]).toBeInstanceOf(OffSource);
    expect(sources[1]).toBeInstanceOf(FridaSource);
    expect(foodSources({ FOOD_SOURCES: "frida" })).toHaveLength(1);
  });
});

describe("foodContributors", () => {
  it("returns nothing without an account", () => {
    expect(foodContributors({})).toEqual([]);
    expect(foodContributors({ OFF_CONTRIBUTE_USER: "fiktiv" })).toEqual([]);
    expect(foodContributors({ OFF_CONTRIBUTE_PASSWORD: "fiktiv" })).toEqual([]);
  });
  it("returns one OffContributor under off when both credentials are set", () => {
    const found = foodContributors({
      OFF_CONTRIBUTE_USER: "fiktiv",
      OFF_CONTRIBUTE_PASSWORD: "kode",
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toBeInstanceOf(OffContributor);
    expect(found[0]?.id).toBe("off");
  });
  it("returns the fake under off when FAKE_FOOD_CONTRIBUTOR=1, even with an account", () => {
    for (const env of [
      { FAKE_FOOD_CONTRIBUTOR: "1" },
      { FAKE_FOOD_CONTRIBUTOR: "1", OFF_CONTRIBUTE_USER: "f", OFF_CONTRIBUTE_PASSWORD: "k" },
    ]) {
      const found = foodContributors(env);
      expect(found).toHaveLength(1);
      expect(found[0]).toBeInstanceOf(FakeFoodContributor);
      expect(found[0]?.id).toBe("off");
    }
    expect(foodContributors({ FAKE_FOOD_CONTRIBUTOR: "0" })).toEqual([]);
  });
  it("passes OFF_CONTRIBUTE_HOST through to the write request", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", (url: string) => {
      calls.push(url);
      return Promise.resolve(Response.json({ status: 1 }));
    });
    const [contributor] = foodContributors({
      OFF_CONTRIBUTE_USER: "fiktiv",
      OFF_CONTRIBUTE_PASSWORD: "kode",
      OFF_CONTRIBUTE_HOST: "off.example.test",
    });
    const result = await contributor?.contribute(
      { barcode: "2000000000008", carbsPer100g: 40, appRef: "a" },
      new AbortController().signal,
    );
    vi.unstubAllGlobals();
    expect(result).toEqual({ status: "ok" });
    expect(calls).toEqual(["https://off.example.test/cgi/product_jqm2.pl"]);
  });
});
