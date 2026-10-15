import { foldForSearch } from "../food/search";
export interface DishItem {
  foodId?: string | null | undefined;
  name: string;
}
/** Names survive deletion of the food reference; portions and item order do not define a dish. */
export function dishKey(items: readonly DishItem[]): string {
  return JSON.stringify([...new Set(items.map((item) => foldForSearch(item.name)))].sort());
}
export function sameDish(a: readonly DishItem[], b: readonly DishItem[]): boolean {
  return dishKey(a) === dishKey(b);
}
