import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { InsightInput, WeekInsightInput } from "@frejsi/shared/schemas/ai";
import type { CompleteResult } from "@frejsi/shared/ai";
import { validatePhoto, photoPath } from "./photo";

export const root = path.resolve(import.meta.dirname, "..");
const base = {
  id: z.string().regex(/^[a-z0-9-]+$/),
  locale: z.enum(["da", "en"]),
  recorded: z.array(z.unknown()).min(1),
};
const expected = z.strictObject({
  name: z.string().min(1),
  carbs: z.number().nonnegative(),
  grams: z.number().positive().optional(),
  portion: z.string().optional(),
});
const schema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...base,
    kind: z.literal("parse"),
    text: z.string().min(1),
    expected: z.array(expected),
    unmatched: z.array(z.string()),
  }),
  z.strictObject({
    ...base,
    kind: z.literal("photo"),
    description: z.string().min(1),
    photo: z.string().min(1),
    items: z.array(expected).min(1),
  }),
  z.strictObject({ ...base, kind: z.literal("meal"), input: InsightInput }),
  z.strictObject({ ...base, kind: z.literal("week"), input: WeekInsightInput }),
  z.strictObject({
    ...base,
    kind: z.literal("normalise"),
    name: z.string().min(1),
    expected: z.string().min(1),
  }),
]);
export type EvalCase = z.infer<typeof schema> & { recorded: CompleteResult[] };
export type Scope = "pr" | "release";
export async function loadCases(): Promise<EvalCase[]> {
  const fixtures = JSON.parse(
    await readFile(path.join(root, "fixtures/answers.json"), "utf8"),
  ) as Record<string, unknown>;
  const cases: EvalCase[] = [];
  for (const folder of ["parse", "photo", "insight", "normalise"]) {
    const names = (await readdir(path.join(root, "cases", folder)))
      .filter((file) => file.endsWith(".json"))
      .sort();
    for (const name of names) {
      const raw: unknown = JSON.parse(
        await readFile(path.join(root, "cases", folder, name), "utf8"),
      );
      const c = schema.parse({
        ...(raw as Record<string, unknown>),
        recorded: fixtures[(raw as { id: string }).id],
      });
      if (cases.some((previous) => previous.id === c.id)) throw new Error("duplicate eval id");
      if (c.kind === "photo" && c.photo !== "pending")
        await validatePhoto(await readFile(photoPath(c.photo)));
      cases.push(c as EvalCase);
    }
  }
  // Orphaned images must pass the same privacy check as referenced photos.
  for (const name of await readdir(path.join(root, "cases/photo/images")))
    if (name !== ".gitkeep") await validatePhoto(await readFile(photoPath(name)));
  return cases;
}
export function selectCases(cases: EvalCase[], scope: Scope): EvalCase[] {
  if (scope === "release") return cases;
  let images = 0;
  return cases.filter(
    (c) => c.kind !== "week" && (c.kind !== "photo" || c.photo === "pending" || ++images <= 10),
  );
}
