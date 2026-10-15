import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { importFrida, parseFridaCsv } from "../../../scripts/import-frida";
import { FridaEntry } from "./entry";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it("imports only available carbohydrate, sorts numerically and emits identical bytes twice", async () => {
  const directory = await mkdtemp(join(tmpdir(), "frejsi-frida-"));
  dirs.push(directory);
  const output = join(directory, "data.json");
  const csv = new URL("../../../../fixtures/frida/frida-excerpt.csv", import.meta.url);
  await importFrida(csv, output);
  const first = await readFile(output, "utf8");
  await importFrida(csv, output);
  expect(await readFile(output, "utf8")).toBe(first);
  const entries = FridaEntry.array().parse(JSON.parse(first) as unknown);
  expect(entries).toHaveLength(9);
  expect(entries.map((entry) => entry.id)).toEqual([901, 902, 904, 905, 906, 907, 908, 909, 910]);
  expect(entries.find((entry) => entry.id === 910)).toEqual({
    id: 910,
    name: { da: "Fiktivt rugbrød, fiberrigt", en: "Fictional rye bread, high fibre" },
    carbsPer100g: 32.5,
    group: "Cereals",
  });
  expect(entries.find((entry) => entry.id === 902)?.carbsPer100g).toBe(12.3);
  expect(entries.find((entry) => entry.id === 904)?.carbsPer100g).toBe(0);
});
it("handles BOM, semicolons, decimal commas, escaped quotes and missing translations", () => {
  const csv =
    '\uFEFFFoodID;FødevareNavn;FoodName;FoodGroup;Available carbohydrates\r\n1;"Fiktiv ""grød""";;Cereals;"12,5"\r\n';
  expect(parseFridaCsv(csv)).toEqual([
    { id: 1, name: { da: 'Fiktiv "grød"', en: "" }, group: "Cereals", carbsPer100g: 12.5 },
  ]);
});
it("refuses missing nutrient headers, invalid values and duplicate ids instead of substituting difference carbs", () => {
  expect(() =>
    parseFridaCsv("FoodID,FoodName,Carbohydrate by difference\n1,Fictional,20"),
  ).toThrow();
  const header = "FoodID,FødevareNavn,FoodName,FoodGroup,Available carbohydrates\n";
  for (const value of ["not-a-number", "-1", "101"])
    expect(() => parseFridaCsv(header + `1,Fiktiv,Fictional,Meals,${value}`)).toThrow();
  expect(() =>
    parseFridaCsv(header + "1,Fiktiv,Fictional,Meals,10\n1,Fiktiv,Fictional,Meals,20"),
  ).toThrow();
  expect(() => parseFridaCsv(header + '1,"unterminated')).toThrow();
});
