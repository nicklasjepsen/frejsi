import type { ParsedItem } from "@frejsi/shared/schemas/ai";
import type { FoodCandidate, FoodView } from "@frejsi/shared/schemas/food";
import type { DraftItem, MealDraft } from "../meal/draft";

type PreparedItem = Omit<DraftItem, "key">;
export async function prepareParsedItems(
  items: ParsedItem[],
  pick: (candidate: FoodCandidate) => Promise<FoodView>,
): Promise<PreparedItem[]> {
  const prepared: PreparedItem[] = [];
  for (const item of items) {
    if (item.estimate) {
      prepared.push({
        name: item.estimate.name,
        food: null,
        choice: null,
        approx: true,
        confidence: item.estimate.confidence,
        snapshot: {
          carbs: item.estimate.carbs,
          ...(item.estimate.grams === undefined ? {} : { grams: item.estimate.grams }),
        },
      });
    } else if (item.match) {
      const food = "id" in item.match.food ? item.match.food : await pick(item.match.food);
      const index = food.portions.findIndex((p) => p.label === item.match?.portionLabel);
      prepared.push({
        name: food.name,
        food,
        choice:
          index >= 0
            ? { portion: index }
            : item.match.grams === undefined
              ? null
              : { grams: item.match.grams },
      });
    }
  }
  return prepared;
}
export function appendParsedItems(draft: MealDraft, items: PreparedItem[]): MealDraft {
  return {
    ...draft,
    items: [...draft.items, ...items.map((item, i) => ({ ...item, key: `i${draft.nextKey + i}` }))],
    nextKey: draft.nextKey + items.length,
  };
}
