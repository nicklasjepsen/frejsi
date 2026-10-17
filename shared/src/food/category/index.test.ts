import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FoodCategory } from "../../schemas/food";
import { FridaEntry } from "../frida/entry";
import { FRIDA_GROUPS } from "./frida-groups";
import { OFF_TAGS } from "./off-tags";
import { fridaCategory, offCategory } from "./index";

const root = path.resolve(import.meta.dirname, "../../../..");
const dataset = path.join(root, "shared/src/food/frida/data", ["frida", "json"].join("."));

describe("Frida groups → FoodCategory (plan §7)", () => {
  const entries = FridaEntry.array().parse(JSON.parse(readFileSync(dataset, "utf8")) as unknown);
  const groups = [...new Set(entries.map((entry) => entry.group))].sort();
  it("maps every one of the 118 groups in the dataset, and nothing else", () => {
    expect(groups).toHaveLength(118);
    const missing = groups.filter((group) => !(group in FRIDA_GROUPS));
    expect(missing).toEqual([]);
    const stale = Object.keys(FRIDA_GROUPS).filter((group) => !groups.includes(group));
    expect(stale).toEqual([]);
    for (const group of groups)
      expect(FoodCategory.safeParse(fridaCategory(group)).success).toBe(true);
  });
  it("uses every category at least once and answers undefined for an unknown group", () => {
    const used = new Set(Object.values(FRIDA_GROUPS));
    expect([...used].sort()).toEqual([...FoodCategory.options].sort());
    expect(fridaCategory("Bread")).toBe("bread");
    expect(fridaCategory("Pasta")).toBe("starch");
    expect(fridaCategory("Not a group")).toBeUndefined();
  });
});

describe("Open Food Facts categories_tags → FoodCategory (plan §7)", () => {
  it("picks the most specific known tag (the last one in OFF's general-to-specific order)", () => {
    expect(offCategory(["en:plant-based-foods", "en:breads", "en:rye-breads"])).toBe("bread");
    expect(offCategory(["en:breads", "en:sandwiches"])).toBe("mixed");
    expect(offCategory(["en:plant-based-foods"])).toBeUndefined();
    expect(offCategory([])).toBeUndefined();
    expect(offCategory(["EN:Fruits "])).toBe("fruit");
  });
  it("knows a handful of tags per category and every value is a category", () => {
    for (const value of Object.values(OFF_TAGS))
      expect(FoodCategory.safeParse(value).success).toBe(true);
    const used = new Set(Object.values(OFF_TAGS));
    expect([...used].sort()).toEqual([...FoodCategory.options].sort());
    for (const tag of Object.keys(OFF_TAGS)) expect(tag).toMatch(/^en:[a-z0-9-]+$/);
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(full);
    return /\.[cm]?tsx?$/.test(entry.name) ? [full] : [];
  });
}

it("keeps OFF tags and Frida group names inside shared/src/food (plugins behind interfaces)", () => {
  const inside = path.join(root, "shared/src/food") + path.sep;
  const offenders = ["shared/src", "web/src", "poller/src"]
    .flatMap((dir) => sources(path.join(root, dir)))
    .filter((file) => !file.startsWith(inside))
    .flatMap((file) => {
      const code = readFileSync(file, "utf8");
      const reasons: string[] = [];
      if (/categories_tags|["'`]en:[a-z-]+["'`]/.test(code)) reasons.push("OFF tag");
      if (/food\/category\/(off-tags|frida-groups)/.test(code)) reasons.push("table import");
      for (const group of Object.keys(FRIDA_GROUPS))
        if (group.includes(" ") && code.includes(`"${group}"`))
          reasons.push(`Frida group ${group}`);
      return reasons.map((reason) => `${path.relative(root, file)}: ${reason}`);
    });
  expect(offenders).toEqual([]);
});
