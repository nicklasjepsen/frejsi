// The meal being built on the log screen: pure functions over a plain value, so the phone and
// desktop layouts share one model and the arithmetic is tested without a browser. Carbs are whole
// grams through `carbsFor` (decision 25); the server recomputes them from the food and ignores the
// client's number whenever it can (plan §4, `MealItemInput`).
import { carbsFor } from "@frejsi/shared/food/portions";
import type { FoodView } from "@frejsi/shared/schemas/food";
import type { CreateMealRequest, MealItemInput, MealView } from "@frejsi/shared/schemas/meal";

export type Choice = { portion: number } | { grams: number };

export interface DraftItem {
  key: string;
  approx?: true;
  confidence?: "low" | "medium" | "high";
  name: string;
  /** The library food; for a stored item, null until it is found in the library again. */
  food: FoodView | null;
  choice: Choice | null;
  /** A stored meal's stored item: name, portion and carbs as they were (§2 snapshot rule). */
  snapshot?: { portionLabel?: string; grams?: number; carbs: number };
}

/** The "Spiser om" chips (issue #191): minutes from the save moment until eating starts. */
export const EATING_IN_CHOICES = [0, 5, 10, 15, 20] as const;
export type EatingIn = (typeof EATING_IN_CHOICES)[number];
/** A meal is usually logged a little before the first bite; 15 minutes is preselected. */
export const DEFAULT_EATING_IN: EatingIn = 15;

export interface MealDraft {
  items: DraftItem[];
  /** ISO time of the meal set by hand; null means the time comes from `eatingIn`, or is "now". */
  ts: string | null;
  /**
   * Minutes until eating starts, resolved against the save moment in `toMealRequest`; null once
   * a time is set by hand (`setMealTime`) or for a saved meal, whose stored time is `ts`.
   */
  eatingIn: EatingIn | null;
  /** The "Bolus givet nu" tap: a time and nothing else. */
  bolusTs: string | null;
  nextKey: number;
}

export const emptyDraft = (): MealDraft => ({
  items: [],
  ts: null,
  eatingIn: DEFAULT_EATING_IN,
  bolusTs: null,
  nextKey: 1,
});

/** A time typed into "Tidspunkt" wins over the chips and deselects them. */
export const setMealTime = (draft: MealDraft, ts: string): MealDraft => ({
  ...draft,
  ts,
  eatingIn: null,
});

/** A chip replaces any hand-set time. */
export const chooseEatingIn = (draft: MealDraft, eatingIn: EatingIn): MealDraft => ({
  ...draft,
  ts: null,
  eatingIn,
});

/**
 * The meal's time for a chip, from the moment of saving: `now + minutes`, or null for "nu" so the
 * server stamps the save moment as it always did. Computed when saving, never when the chips render.
 */
export function eatingInTs(eatingIn: EatingIn, now: Date): string | null {
  return eatingIn === 0 ? null : new Date(now.getTime() + eatingIn * 60_000).toISOString();
}

/** The time to send: the hand-set time, else the chip resolved against `now`, else nothing. */
export function mealTs(draft: MealDraft, now: Date): string | null {
  if (draft.ts) return draft.ts;
  return draft.eatingIn === null ? null : eatingInTs(draft.eatingIn, now);
}

export function addFood(draft: MealDraft, food: FoodView): MealDraft {
  const single = food.carbsPer100g == null && food.portions.length === 1;
  const item: DraftItem = {
    key: `i${draft.nextKey}`,
    name: food.name,
    food,
    choice: single ? { portion: 0 } : null,
  };
  return { ...draft, items: [...draft.items, item], nextKey: draft.nextKey + 1 };
}

/** A new choice replaces a stored item's stored snapshot. */
const update = (draft: MealDraft, key: string, choice: Choice | null): MealDraft => ({
  ...draft,
  items: draft.items.map((item) => {
    if (item.key !== key) return item;
    const { snapshot: _snapshot, ...rest } = item;
    return { ...rest, choice };
  }),
});

export const choosePortion = (draft: MealDraft, key: string, portion: number) =>
  update(draft, key, { portion });

export const chooseGrams = (draft: MealDraft, key: string, grams: number) =>
  update(draft, key, { grams });

/** No valid quantity on screen (an emptied grams field): the meal cannot be saved yet. */
export const clearChoice = (draft: MealDraft, key: string) => update(draft, key, null);

/**
 * A stored item's food, found again in the library: its portions become choosable, and the
 * stored portion is shown as chosen, while the snapshot stays what is saved until one is changed.
 */
export function relinkFood(draft: MealDraft, key: string, food: FoodView): MealDraft {
  return {
    ...draft,
    items: draft.items.map((item) => {
      if (item.key !== key || !item.snapshot || item.food) return item;
      const index = food.portions.findIndex((p) => p.label === item.snapshot?.portionLabel);
      const grams = item.snapshot.grams;
      const choice: Choice | null =
        index >= 0 ? { portion: index } : grams !== undefined ? { grams } : null;
      return { ...item, food, choice };
    }),
  };
}

export const removeItem = (draft: MealDraft, key: string): MealDraft => ({
  ...draft,
  items: draft.items.filter((item) => item.key !== key),
});

/** The item's carbs, or null while no portion is chosen. */
export function itemCarbs(item: DraftItem): number | null {
  if (item.snapshot) return item.snapshot.carbs;
  if (!item.food || !item.choice) return null;
  if ("portion" in item.choice) {
    const portion = item.food.portions[item.choice.portion];
    return portion ? carbsFor(item.food, portion) : null;
  }
  return item.food.carbsPer100g == null ? null : carbsFor(item.food, item.choice.grams);
}

export function portionLabel(item: DraftItem): string | undefined {
  if (item.snapshot) return item.snapshot.portionLabel;
  if (item.food && item.choice && "portion" in item.choice) {
    return item.food.portions[item.choice.portion]?.label;
  }
  return undefined;
}

export function itemGrams(item: DraftItem): number | undefined {
  if (item.snapshot) return item.snapshot.grams;
  return item.choice && "grams" in item.choice ? item.choice.grams : undefined;
}

export const totalCarbs = (draft: MealDraft): number =>
  draft.items.reduce((sum, item) => sum + (itemCarbs(item) ?? 0), 0);

export const isComplete = (draft: MealDraft): boolean =>
  draft.items.length > 0 && draft.items.every((item) => itemCarbs(item) !== null);

/** The total for a bar: null until every item has a choice, so no fake "0 g" is ever shown. */
export const knownTotal = (draft: MealDraft): number | null =>
  isComplete(draft) ? totalCarbs(draft) : null;

function toItemInput(item: DraftItem): MealItemInput {
  const carbs = itemCarbs(item) ?? 0;
  // An unchanged snapshot goes back as stored: with a food id the server would recompute it from
  // the food as it is today (§2 snapshot rule).
  if (item.snapshot) {
    return {
      name: item.name,
      ...(item.snapshot.portionLabel !== undefined
        ? { portionLabel: item.snapshot.portionLabel }
        : {}),
      ...(item.snapshot.grams !== undefined ? { grams: item.snapshot.grams } : {}),
      carbs: item.snapshot.carbs,
    };
  }
  const label = portionLabel(item);
  const grams = itemGrams(item);
  return {
    ...(item.food ? { foodId: item.food.id } : {}),
    name: item.name,
    ...(label !== undefined ? { portionLabel: label } : {}),
    ...(grams !== undefined ? { grams } : {}),
    carbs,
  };
}

/**
 * The body for `POST meals` (and `PATCH meals/[id]`, where `items` replaces the stored ones).
 * `now` is the save moment the "Spiser om" chip counts from.
 */
export function toMealRequest(
  draft: MealDraft,
  photoDataUrl: string | null,
  now: Date = new Date(),
): CreateMealRequest {
  const ts = mealTs(draft, now);
  return {
    ...(ts ? { ts } : {}),
    items: draft.items.map(toItemInput),
    ...(draft.bolusTs ? { bolusTs: draft.bolusTs } : {}),
    ...(photoDataUrl ? { photoDataUrl } : {}),
  };
}

/** A saved meal represented as stored snapshots for API clients. */
export function draftFromMeal(meal: MealView): MealDraft {
  return {
    items: meal.items.map((item, index) => ({
      key: `s${index + 1}`,
      name: item.name,
      food: null,
      choice: null,
      snapshot: {
        carbs: item.carbs,
        ...(item.portionLabel !== undefined ? { portionLabel: item.portionLabel } : {}),
        ...(item.grams !== undefined ? { grams: item.grams } : {}),
      },
    })),
    ts: meal.ts,
    eatingIn: null,
    bolusTs: meal.bolusTs ?? null,
    nextKey: 1,
  };
}
