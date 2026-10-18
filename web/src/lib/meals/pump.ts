// Meal writes and the pump record (v0.7.0 plan §6): after a person creates, moves or deletes a
// meal, the meals around its old and new time are matched to the stored boluses again with the
// shared matcher, and only `diffLinks`' differences are written, inside the meal's own
// Serializable transaction. Every other meal the match changed is listed in `pump.meals`, which
// travels in the glucose group, so a viewer never hears what the pump record did.
import {
  AFTER_MINUTES,
  BEFORE_MINUTES,
  diffLinks,
  matchBoluses,
  type MatchBolus,
  type MatchBolusKind,
  type MatchMeal,
  type PrismaClient,
} from "@frejsi/shared";
import type { z } from "zod";
import type { PumpMealsPayload } from "@frejsi/shared/schemas/events";

const MINUTE = 60_000;

export interface TimeRange {
  from: Date;
  to: Date;
}
export interface LinkedBolus extends MatchBolus {
  /** The meals that hold this bolus now; one at most when the invariant holds. */
  mealIds: string[];
}
/** The pump side of a meal write, over the transaction the meal write runs in. */
export interface PumpLinks {
  /** Meals with a time in any of the ranges (inclusive), with what the matcher reads. */
  meals(spaceId: string, ranges: TimeRange[]): Promise<MatchMeal[]>;
  /** Boluses with a time in any of the ranges, or with an id in `ids`. */
  boluses(spaceId: string, ranges: TimeRange[], ids: string[]): Promise<LinkedBolus[]>;
  link(spaceId: string, mealId: string, bolusId: string, bolusTs: string): Promise<void>;
  /** Clears `pumpBolusId` and the `bolusTs` the pump set. */
  unlink(spaceId: string, mealId: string): Promise<void>;
  /** Deletes a meal only while it is an untouched pump meal. */
  removePumpMeal(spaceId: string, mealId: string): Promise<void>;
  /** A person deleted the pump meal made from this bolus: the cycle never makes another. */
  dismiss(spaceId: string, bolusId: string): Promise<void>;
}

type PumpDb = Pick<PrismaClient, "meal" | "pumpBolus">;
const KINDS: readonly MatchBolusKind[] = ["standard", "extended", "automatic", "other"];
const kind = (value: string): MatchBolusKind =>
  (KINDS as readonly string[]).includes(value) ? (value as MatchBolusKind) : "other";
const inRanges = (ranges: TimeRange[]) =>
  ranges.map((range) => ({ ts: { gte: range.from, lte: range.to } }));

export class PrismaPumpLinks implements PumpLinks {
  constructor(private readonly db: PumpDb) {}
  async meals(spaceId: string, ranges: TimeRange[]): Promise<MatchMeal[]> {
    const rows = await this.db.meal.findMany({
      where: { spaceId, OR: inRanges(ranges) },
      select: { id: true, ts: true, source: true, pumpBolusId: true, bolusTs: true },
    });
    return rows.map((row) => ({
      id: row.id,
      ts: row.ts.toISOString(),
      source: row.source,
      pumpBolusId: row.pumpBolusId,
      bolusTs: row.bolusTs?.toISOString() ?? null,
    }));
  }
  async boluses(spaceId: string, ranges: TimeRange[], ids: string[]): Promise<LinkedBolus[]> {
    const rows = await this.db.pumpBolus.findMany({
      where: { spaceId, OR: [...inRanges(ranges), ...(ids.length ? [{ id: { in: ids } }] : [])] },
      select: { id: true, ts: true, kind: true, meals: { select: { id: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      ts: row.ts.toISOString(),
      kind: kind(row.kind),
      mealIds: row.meals.map((meal) => meal.id),
    }));
  }
  async link(spaceId: string, mealId: string, bolusId: string, bolusTs: string): Promise<void> {
    await this.db.meal.updateMany({
      where: { id: mealId, spaceId },
      data: { pumpBolusId: bolusId, bolusTs: new Date(bolusTs) },
    });
  }
  async unlink(spaceId: string, mealId: string): Promise<void> {
    await this.db.meal.updateMany({
      where: { id: mealId, spaceId },
      data: { pumpBolusId: null, bolusTs: null },
    });
  }
  async removePumpMeal(spaceId: string, mealId: string): Promise<void> {
    await this.db.meal.deleteMany({ where: { id: mealId, spaceId, source: "pump" } });
  }
  async dismiss(spaceId: string, bolusId: string): Promise<void> {
    await this.db.pumpBolus.updateMany({
      where: { id: bolusId, spaceId },
      data: { mealDismissed: true },
    });
  }
}

/**
 * Re-matches the meals that can compete with a meal at any of `times` for a bolus: a meal takes a
 * bolus from 45 minutes before it to 30 after, so every meal within 75 minutes of a time is loaded,
 * with every bolus any of them could take and the bolus each holds now (so its link is judged
 * again). A bolus held by a meal outside that set stays with it. Returns the `pump.meals` payload
 * for every meal changed besides `own`, or null when nothing else changed.
 *
 * `released` is the bolus `own` held before the write. When the write leaves it with no meal and
 * `own` with no bolus (moved out of the window, or deleted), the person has decided about those
 * carbs: the bolus is dismissed, so the pump cycle does not make a second meal from them. A meal
 * that swaps one bolus for another leaves the first free.
 */
export async function rematch(
  links: PumpLinks,
  spaceId: string,
  times: readonly string[],
  own?: string,
  released?: string,
): Promise<z.infer<typeof PumpMealsPayload> | null> {
  const reach = (BEFORE_MINUTES + AFTER_MINUTES) * MINUTE;
  const mealRanges = [...new Set(times)].map((ts) => ({
    from: new Date(Date.parse(ts) - reach),
    to: new Date(Date.parse(ts) + reach),
  }));
  const meals = await links.meals(spaceId, mealRanges);
  const bolusRanges = mealRanges.map((range) => ({
    from: new Date(+range.from - BEFORE_MINUTES * MINUTE),
    to: new Date(+range.to + AFTER_MINUTES * MINUTE),
  }));
  const held = [...new Set(meals.flatMap((meal) => meal.pumpBolusId ?? []))];
  const loaded = new Set(meals.map((meal) => meal.id));
  const boluses = (await links.boluses(spaceId, bolusRanges, held)).filter((bolus) =>
    bolus.mealIds.every((id) => loaded.has(id)),
  );
  const diff = diffLinks(meals, matchBoluses(meals, boluses));
  for (const link of diff.set) await links.link(spaceId, link.mealId, link.bolusId, link.bolusTs);
  for (const { mealId } of diff.clear) await links.unlink(spaceId, mealId);
  for (const { mealId } of diff.removePumpMeals) await links.removePumpMeal(spaceId, mealId);
  if (released) {
    const holds = new Map(
      meals.flatMap((meal) => (meal.pumpBolusId ? [[meal.id, meal.pumpBolusId]] : [])),
    );
    for (const link of diff.set) holds.set(link.mealId, link.bolusId);
    for (const { mealId } of [...diff.clear, ...diff.removePumpMeals]) holds.delete(mealId);
    const ownHolds = own !== undefined && holds.has(own);
    if (!ownHolds && ![...holds.values()].includes(released))
      await links.dismiss(spaceId, released);
  }
  const updated = [...new Set([...diff.set, ...diff.clear].map((change) => change.mealId))].filter(
    (id) => id !== own,
  );
  const removed = diff.removePumpMeals.map((change) => change.mealId).filter((id) => id !== own);
  return updated.length || removed.length ? { updated, created: [], removed } : null;
}
