import { z } from "zod";

import { FoodCandidate, type Food, type FoodSourceStatus } from "../schemas/food";
import type { Locale } from "../schemas/settings";

export type { FoodSourceStatus } from "../schemas/food";
export interface FoodSourceResult {
  status: FoodSourceStatus;
  candidates: FoodCandidate[];
}
export interface FoodSource {
  id: string;
  kind: "remote" | "local";
  search(q: string, locale: Locale, signal: AbortSignal): Promise<FoodSourceResult>;
  byBarcode(barcode: string, signal: AbortSignal): Promise<FoodSourceResult>;
}
export interface LibraryOptions {
  verifiedOnly?: boolean;
}
export const CacheFoodInput = FoodCandidate.safeExtend({
  spaceId: z.null(),
  verified: z.literal(false),
});
export type CacheFoodInput = z.infer<typeof CacheFoodInput>;

/** The only write available to lookup is a shared-cache write, never a space write. */
export interface FoodRepository {
  searchLibrary(spaceId: string, q: string, options?: LibraryOptions): Promise<Food[]>;
  findLibraryByBarcode(spaceId: string, barcode: string, options?: LibraryOptions): Promise<Food[]>;
  searchCache(q: string, excludeSourceRefs?: string[]): Promise<Food[]>;
  findCacheByBarcode(barcode: string, excludeSourceRefs?: string[]): Promise<Food[]>;
  upsertCache(food: CacheFoodInput): Promise<Food>;
}
