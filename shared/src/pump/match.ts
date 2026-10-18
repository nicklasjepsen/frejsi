/**
 * The pure rules of v0.7.0 plan §6: which bolus belongs to which meal, and what the stored links
 * must become. Structural input types, so the web meal service and the pump cycle call it the same
 * way and it imports nothing from the schemas. Deterministic: the same input in any order gives the
 * same result.
 */

/** The window the owner agreed (plan decision 7): a pre-bolus up to 45 min, a late bolus up to 30. */
export const BEFORE_MINUTES = 45;
export const AFTER_MINUTES = 30;

export type MatchBolusKind = "standard" | "extended" | "automatic" | "other";

export interface MatchMeal {
  id: string;
  /** ISO timestamp. */
  ts: string;
  /** `"pump"` for an untouched meal the pump record made; null for every other meal. */
  source: string | null;
  pumpBolusId: string | null;
  /** The stored bolus time, tapped or pump-set; `diffLinks` compares it. */
  bolusTs?: string | null;
}

export interface MatchBolus {
  id: string;
  /** ISO timestamp. */
  ts: string;
  kind: MatchBolusKind;
}

export interface MatchLink {
  mealId: string;
  bolusId: string;
  /** The bolus's time, which becomes the meal's `bolusTs`. */
  bolusTs: string;
}

export interface LinkDiff {
  /** Links to write: `pumpBolusId` and `bolusTs` from the bolus. */
  set: MatchLink[];
  /** Meals that lost their pump bolus: `pumpBolusId` and `bolusTs` both cleared. */
  clear: { mealId: string }[];
  /** Untouched pump meals whose bolus went to a person's meal: deleted by the caller. */
  removePumpMeals: { mealId: string }[];
}

const MINUTE = 60_000;
/** Only a bolus a person gave for food attaches to a meal (plan decision 8). */
const attaches = (kind: MatchBolusKind) => kind === "standard" || kind === "extended";
const isUntouchedPumpMeal = (meal: MatchMeal) => meal.source === "pump";
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

interface Candidate {
  meal: MatchMeal;
  bolus: MatchBolus;
  distance: number;
  /** 0 when the bolus is before the meal (the tie winner), 1 when after. */
  after: 0 | 1;
}

/**
 * Pairs each meal with at most one bolus and each bolus with at most one meal: a pair is possible
 * from 45 minutes before the meal to 30 after; pairs are taken by the smallest distance, a tie
 * going to the bolus before the meal, then the earlier meal. Untouched pump meals keep the bolus
 * they were made from unless a person's meal takes it, and are never given another.
 *
 * A stored link whose bolus is not in `boluses` is kept as it is, for a person's meal as for a
 * pump meal, and that meal takes part in no new pairing: the matcher cannot judge a bolus it was
 * not given, and the database keeps a linked bolus from being deleted, so a missing bolus only
 * means the caller did not load it. A caller that wants a link re-judged (a meal that moved, say)
 * passes the meal's current bolus along with the boluses of the window.
 */
export function matchBoluses(
  meals: readonly MatchMeal[],
  boluses: readonly MatchBolus[],
): MatchLink[] {
  const given = new Set(boluses.map((bolus) => bolus.id));
  const keepsStoredLink = (meal: MatchMeal) =>
    meal.pumpBolusId !== null && !given.has(meal.pumpBolusId);
  const people = meals.filter((meal) => !isUntouchedPumpMeal(meal) && !keepsStoredLink(meal));
  const pool = boluses.filter((bolus) => attaches(bolus.kind));
  const candidates: Candidate[] = [];
  for (const meal of people) {
    const mealAt = Date.parse(meal.ts);
    for (const bolus of pool) {
      const offset = Date.parse(bolus.ts) - mealAt;
      if (offset < -BEFORE_MINUTES * MINUTE || offset > AFTER_MINUTES * MINUTE) continue;
      candidates.push({ meal, bolus, distance: Math.abs(offset), after: offset > 0 ? 1 : 0 });
    }
  }
  candidates.sort(
    (a, b) =>
      a.distance - b.distance ||
      a.after - b.after ||
      Date.parse(a.meal.ts) - Date.parse(b.meal.ts) ||
      byId(a.meal.id, b.meal.id) ||
      byId(a.bolus.id, b.bolus.id),
  );
  const takenMeals = new Set<string>();
  const takenBoluses = new Set<string>();
  const links: MatchLink[] = [];
  for (const { meal, bolus } of candidates) {
    if (takenMeals.has(meal.id) || takenBoluses.has(bolus.id)) continue;
    takenMeals.add(meal.id);
    takenBoluses.add(bolus.id);
    links.push({ mealId: meal.id, bolusId: bolus.id, bolusTs: bolus.ts });
  }
  const bolusTimes = new Map(boluses.map((bolus) => [bolus.id, bolus.ts]));
  // The meals that keep a stored link: those whose bolus the matcher was not given, and the
  // untouched pump meals. Earliest first, so the result does not depend on the input's order.
  const keepers = meals
    .filter((meal) => meal.pumpBolusId !== null)
    .filter((meal) => keepsStoredLink(meal) || isUntouchedPumpMeal(meal))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || byId(a.id, b.id));
  for (const meal of keepers) {
    if (meal.pumpBolusId === null || takenBoluses.has(meal.pumpBolusId)) continue;
    takenBoluses.add(meal.pumpBolusId);
    links.push({
      mealId: meal.id,
      bolusId: meal.pumpBolusId,
      bolusTs: bolusTimes.get(meal.pumpBolusId) ?? meal.bolusTs ?? meal.ts,
    });
  }
  const mealTime = new Map(meals.map((meal) => [meal.id, Date.parse(meal.ts)]));
  return links.sort(
    (a, b) =>
      (mealTime.get(a.mealId) ?? 0) - (mealTime.get(b.mealId) ?? 0) || byId(a.mealId, b.mealId),
  );
}

/**
 * Turns the stored links and a match into the writes, and nothing for an unchanged day. A meal
 * whose link or bolus time differs is set; a person's meal that had a pump bolus and has none now
 * is cleared (a tapped `bolusTs` with no `pumpBolusId` is not the pump's to clear); an untouched
 * pump meal that lost its bolus is removed.
 */
export function diffLinks(current: readonly MatchMeal[], matched: readonly MatchLink[]): LinkDiff {
  const stored = new Map(current.map((meal) => [meal.id, meal]));
  const linked = new Map(matched.map((link) => [link.mealId, link]));
  const set = matched.filter((link) => {
    const meal = stored.get(link.mealId);
    return meal?.pumpBolusId !== link.bolusId || (meal.bolusTs ?? null) !== link.bolusTs;
  });
  const lost = current.filter((meal) => meal.pumpBolusId !== null && !linked.has(meal.id));
  return {
    set,
    clear: lost.filter((meal) => !isUntouchedPumpMeal(meal)).map((meal) => ({ mealId: meal.id })),
    removePumpMeals: lost.filter(isUntouchedPumpMeal).map((meal) => ({ mealId: meal.id })),
  };
}
