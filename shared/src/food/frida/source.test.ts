import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, expectTypeOf, it, vi } from "vitest";
import { FoodCandidate } from "../../schemas/food";
import { FridaEntry } from "./entry";
import { FridaSource } from "./source";

const signal = () => new AbortController().signal;
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
const entries = [
  {
    id: 1,
    name: { da: "Fiktivt rugbrød, kogt", en: "Fictional rye bread, cooked" },
    carbsPer100g: 32.5,
    group: "Bread",
  },
  {
    id: 2,
    name: { da: "", en: "Fictional crème porridge" },
    carbsPer100g: 12,
    group: "Grain and groats",
  },
  { id: 3, name: { da: "Fiktiv grød", en: "" }, carbsPer100g: 15, group: "Not a Frida group" },
];
it("lazily loads once, folds all words and falls back to the other locale", async () => {
  const directory = await mkdtemp(join(tmpdir(), "frejsi-frida-"));
  dirs.push(directory);
  const file = join(directory, "fictional.json");
  await writeFile(file, JSON.stringify(entries));
  const load = vi.fn(async () => JSON.parse(await readFile(file, "utf8")) as unknown);
  const source = new FridaSource(load);
  expect(load).not.toHaveBeenCalled();
  expect(source.kind).toBe("local");
  const [first] = await Promise.all([
    source.search("KOGT rugbrod", "da", signal()),
    source.search("creme", "da", signal()),
  ]);
  expect(first).toEqual({
    status: "ok",
    candidates: [
      {
        name: "Fiktivt rugbrød, kogt",
        origin: "frida",
        sourceRef: "frida:1",
        carbsPer100g: 32.5,
        portions: [],
        category: "bread",
      },
    ],
  });
  expect((await source.search("creme", "da", signal())).candidates[0]?.name).toBe(
    "Fictional crème porridge",
  );
  expect((await source.search("grod", "en", signal())).candidates[0]).toMatchObject({
    name: "Fiktiv grød",
  });
  // A group the table does not know gives no category rather than a wrong one.
  expect((await source.search("grod", "en", signal())).candidates[0]).not.toHaveProperty(
    "category",
  );
  expect((await source.search("creme", "da", signal())).candidates[0]?.category).toBe("starch");
  expect((await source.search("kogt rye", "da", signal())).candidates).toEqual([]);
  expect(load).toHaveBeenCalledTimes(1);
  expect(await source.byBarcode("2000000000008", signal())).toEqual({
    status: "skipped",
    candidates: [],
  });
  for (const candidate of first.candidates) {
    expect(FoodCandidate.parse(candidate)).not.toHaveProperty("verified");
    expect(candidate).not.toHaveProperty("barcode");
  }
  expectTypeOf<Extract<keyof FoodCandidate, "verified">>().toEqualTypeOf<never>();
});
it("caps search at ten and honours cancellation and invalid datasets", async () => {
  const source = new FridaSource(() =>
    Promise.resolve(Array.from({ length: 12 }, (_, i) => ({ ...entries[0], id: i + 1 }))),
  );
  expect((await source.search("rug", "da", signal())).candidates).toHaveLength(10);
  const abort = new AbortController();
  abort.abort();
  expect((await source.search("rug", "da", abort.signal)).status).toBe("timeout");
  expect(
    (await new FridaSource(() => Promise.resolve([{}])).search("rug", "da", signal())).status,
  ).toBe("error");
});
it("the committed dataset conforms to FridaEntry[] with unique sorted ids", async () => {
  const data = FridaEntry.array().parse(
    JSON.parse(await readFile(new URL("./data/frida.json", import.meta.url), "utf8")) as unknown,
  );
  expect(data.length).toBeGreaterThan(1000);
  expect(data.map((e) => e.id)).toEqual([...new Set(data.map((e) => e.id))].sort((a, b) => a - b));
});
it("answers a pick by reference from the dataset, with the group's category (plan §7)", async () => {
  const source = new FridaSource(() => Promise.resolve(entries));
  expect(await source.byRef("frida:1", "da", signal())).toEqual({
    name: "Fiktivt rugbrød, kogt",
    origin: "frida",
    sourceRef: "frida:1",
    carbsPer100g: 32.5,
    portions: [],
    category: "bread",
  });
  expect((await source.byRef("frida:2", "da", signal()))?.name).toBe("Fictional crème porridge");
  expect(await source.byRef("frida:9", "da", signal())).toBeNull();
  expect(await source.byRef("off:1", "da", signal())).toBeNull();
  expect(await source.byRef("frida:x", "da", signal())).toBeNull();
  const abort = new AbortController();
  abort.abort();
  expect(await source.byRef("frida:1", "da", abort.signal)).toBeNull();
});
it("the committed dataset places rugbrød under bread and every hit in a category", async () => {
  const result = await new FridaSource().search("rugbrød", "da", signal());
  expect(result.status).toBe("ok");
  expect(result.candidates.length).toBeGreaterThanOrEqual(5);
  for (const candidate of result.candidates) expect(candidate.category).toBeDefined();
  expect(result.candidates.filter((candidate) => candidate.category === "bread").length).toBe(
    result.candidates.length - 1,
  );
});
