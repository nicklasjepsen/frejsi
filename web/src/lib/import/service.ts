// Importing an export file into a space (#154): parse, store the readings the space lacks, and
// turn the file's carb entries into meals. Nothing of the file but readings and carbs is kept,
// and nothing of it is logged: counts only.
import {
  GlucoseImportError,
  HttpError,
  parseGlucoseImport,
  storeImportedReadings,
  type EmitFn,
  type GlucoseImportRequest,
  type GlucoseImportResult,
  type ImportDb,
  type ImportedCarbs,
  type SessionContext,
} from "@frejsi/shared";

import { getMessages } from "@/lib/i18n/messages";
import { LOCALES } from "@/lib/i18n/routing";
import { createMeal, type MealDeps } from "@/lib/meals/service";

/** The delegates the import reads and writes through beyond the meal service's own. */
export type ImportServiceDb = ImportDb & {
  space: {
    findUnique(args: {
      where: { id: string };
      select: { timezone: true };
    }): Promise<{ timezone: string } | null>;
  };
  meal: {
    findMany(args: {
      where: { spaceId: string; ts: { gte: Date; lte: Date }; note: { in: string[] } };
      select: { ts: true; totalCarbs: true };
    }): Promise<{ ts: Date; totalCarbs: number }[]>;
  };
};

export interface ImportDeps {
  db: ImportServiceDb;
  emit: EmitFn;
  /** What `createMeal` writes through; the route passes the real repository and writer. */
  meals: Partial<MealDeps>;
}

/** The note every imported meal carries, in each locale, so a re-import recognises its own meals. */
const importNotes = (): string[] => LOCALES.map((l) => getMessages(l).settings.import.mealNote);

const key = (ts: Date | string, carbs: number) => `${new Date(ts).toISOString()}|${carbs}`;

/**
 * One meal per carb entry the space does not have yet: a single manual line with the grams as the
 * Dexcom app had them, no linked food, the import note. Nothing about it is verified; a carer
 * edits it like any other meal. An entry the file holds twice, or that was imported before,
 * is skipped by its time and grams.
 */
async function createMeals(
  spaceId: string,
  session: SessionContext,
  carbs: ImportedCarbs[],
  deps: ImportDeps,
): Promise<GlucoseImportResult["meals"]> {
  if (carbs.length === 0) return { added: 0, skipped: 0 };
  const times = carbs.map((c) => Date.parse(c.ts));
  const existing = await deps.db.meal.findMany({
    where: {
      spaceId,
      ts: { gte: new Date(Math.min(...times)), lte: new Date(Math.max(...times)) },
      note: { in: importNotes() },
    },
    select: { ts: true, totalCarbs: true },
  });
  const seen = new Set(existing.map((m) => key(m.ts, m.totalCarbs)));
  const copy = getMessages(session.locale).settings.import;
  let added = 0;
  let skipped = 0;
  for (const entry of carbs) {
    const k = key(entry.ts, entry.grams);
    if (seen.has(k)) {
      skipped += 1;
      continue;
    }
    try {
      await createMeal(
        spaceId,
        session,
        { ts: entry.ts, items: [{ name: copy.carbItem, carbs: entry.grams }], note: copy.mealNote },
        deps.meals,
      );
    } catch (error) {
      // An entry the meal contract refuses (more carbs than a meal may hold) is left out, not
      // the whole import.
      if (error instanceof HttpError && error.code === "validation") {
        skipped += 1;
        continue;
      }
      throw error;
    }
    seen.add(k);
    added += 1;
  }
  return { added, skipped };
}

export async function importGlucose(
  spaceId: string,
  session: SessionContext,
  input: GlucoseImportRequest,
  deps: ImportDeps,
): Promise<GlucoseImportResult> {
  const space = await deps.db.space.findUnique({
    where: { id: spaceId },
    select: { timezone: true },
  });
  if (!space) throw new HttpError(404, "not-found");

  let parsed;
  try {
    parsed = parseGlucoseImport(input.text, { timezone: space.timezone });
  } catch (error) {
    if (error instanceof GlucoseImportError) throw new HttpError(400, error.code);
    throw error;
  }

  const readings = await storeImportedReadings(
    { db: deps.db, emit: deps.emit, source: `import:${parsed.format}` },
    spaceId,
    parsed.readings,
  );
  const meals = input.createMeals
    ? await createMeals(spaceId, session, parsed.carbs, deps)
    : { added: 0, skipped: parsed.carbs.length };

  return { format: parsed.format, readings, meals, otherRows: parsed.otherRows };
}
