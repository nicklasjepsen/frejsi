import { FoodOrigin } from "../schemas/food";
import type { FoodSource } from "./types";

export interface FoodSourceEnv {
  [key: string]: string | undefined;
  FOOD_SOURCES?: string;
}
export type FoodSourceFactory = (env: FoodSourceEnv) => FoodSource;
const factories = new Map<string, FoodSourceFactory>();

/** Adapter lanes append registrations here. Registration alone never enables a plugin. */
export function registerFoodSource(id: string, factory: FoodSourceFactory): () => void {
  FoodOrigin.parse(id);
  if (id === "library" || id === "cache" || factories.has(id))
    throw new Error(`Duplicate or reserved food source: ${id}`);
  factories.set(id, factory);
  return () => {
    factories.delete(id);
  };
}

export function foodSources(env: FoodSourceEnv): FoodSource[] {
  const ids = [
    ...new Set(
      (env.FOOD_SOURCES ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  return ids.map((id) => {
    const factory = factories.get(id);
    if (!factory) throw new Error(`Unknown food source: ${id}`);
    const source = factory(env);
    if (source.id !== id) throw new Error(`Food source id mismatch: ${id}`);
    return source;
  });
}
