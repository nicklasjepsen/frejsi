export const SEMANTIC_MAX_DISTANCE = 0.35;
export interface SemanticHit<T> {
  food: T;
  distance: number;
}
export function mergeSemantic<T extends { id: string }>(
  keywords: T[],
  hits: SemanticHit<T>[],
): T[] {
  const seen = new Set(keywords.map((food) => food.id));
  const result = [...keywords];
  for (const { food, distance } of hits) {
    if (!Number.isFinite(distance) || distance > SEMANTIC_MAX_DISTANCE || seen.has(food.id))
      continue;
    seen.add(food.id);
    result.push(food);
  }
  return result;
}
