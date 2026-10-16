import { FoodOrigin } from "../schemas/food";
import type { FoodContributor, FoodSource } from "./types";

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

import { OffSource } from "./off/source";
import { FridaSource } from "./frida/source";
import { OffContributor } from "./off/contribute";
import { FakeFoodContributor } from "./fake-contributor";

registerFoodSource(
  "off",
  (env) =>
    new OffSource({
      fetch: globalThis.fetch,
      country: env.OFF_COUNTRY,
      version: env.APP_VERSION ?? env.NEXT_PUBLIC_APP_VERSION ?? "dev",
      locale: env.OFF_LANGUAGE === "da" ? "da" : "en",
    }),
);
registerFoodSource("frida", () => new FridaSource());

export interface FoodContributorEnv {
  [key: string]: string | undefined;
  OFF_CONTRIBUTE_USER?: string;
  OFF_CONTRIBUTE_PASSWORD?: string;
  OFF_CONTRIBUTE_HOST?: string;
  FAKE_FOOD_CONTRIBUTOR?: string;
}
/**
 * The contributors this deployment has configured. A deployment without an OFF account has none,
 * so no screen offers to send a correction; configuration switches it on, never code.
 */
export function foodContributors(env: FoodContributorEnv): FoodContributor[] {
  if (env.FAKE_FOOD_CONTRIBUTOR === "1") return [new FakeFoodContributor()];
  const user = env.OFF_CONTRIBUTE_USER?.trim();
  const password = env.OFF_CONTRIBUTE_PASSWORD;
  if (!user || !password) return [];
  return [
    new OffContributor({
      fetch: globalThis.fetch,
      user,
      password,
      host: env.OFF_CONTRIBUTE_HOST,
      version: env.APP_VERSION ?? env.NEXT_PUBLIC_APP_VERSION ?? "dev",
    }),
  ];
}
