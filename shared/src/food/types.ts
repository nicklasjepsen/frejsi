import type { EmitFn } from "../events/emit";
import { z } from "zod";

import {
  FoodCandidate,
  type ContributionResult,
  type Food,
  type FoodCorrection,
  type FoodSourceStatus,
  type Portion,
} from "../schemas/food";
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
  /**
   * The candidate behind one of this source's `sourceRef`s, read again from the source, or null
   * when the reference is not one of its own or no longer resolves. A local dataset answers it
   * without the network; the space-copy service uses it so a pick's data, including its category,
   * comes from the dataset and never from the client (v0.6.0 plan §7). Optional: a source without
   * it keeps the client's unverified copy as before.
   */
  byRef?(sourceRef: string, locale: Locale, signal: AbortSignal): Promise<FoodCandidate | null>;
}
/**
 * Sends a human-approved correction back to the source a food came from (spec §4). Never called
 * automatically; the one caller is the contributions service in web/.
 */
export interface FoodContributor {
  id: string;
  contribute(correction: FoodCorrection, signal: AbortSignal): Promise<ContributionResult>;
}
export interface LibraryOptions {
  verifiedOnly?: boolean;
}
export const CacheFoodInput = FoodCandidate.safeExtend({
  spaceId: z.null(),
  verified: z.literal(false),
});
export type CacheFoodInput = z.infer<typeof CacheFoodInput>;

/** A query vector and its model identity; never mixed with another provider's vectors. */
export interface SearchEmbedding {
  vector: number[];
  model: string;
}
export type SearchEmbed = (q: string) => Promise<SearchEmbedding | null>;
export interface FoodEmbedding {
  id: string;
  vector: number[];
  model: string;
  name?: string;
}
export interface SemanticFood {
  food: Food;
  distance: number;
}

export interface FoodRepository {
  searchLibrarySemantic(
    spaceId: string,
    vector: number[],
    model: string,
    limit: number,
    options?: LibraryOptions,
  ): Promise<SemanticFood[]>;
  searchCacheSemantic(vector: number[], model: string, limit: number): Promise<SemanticFood[]>;
  setEmbeddings(rows: FoodEmbedding[]): Promise<void>;
  searchLibrary(spaceId: string, q: string, options?: LibraryOptions): Promise<Food[]>;
  findLibraryByBarcode(spaceId: string, barcode: string, options?: LibraryOptions): Promise<Food[]>;
  searchCache(q: string, excludeSourceRefs?: string[]): Promise<Food[]>;
  findCacheByBarcode(barcode: string, excludeSourceRefs?: string[]): Promise<Food[]>;
  upsertCache(food: CacheFoodInput): Promise<Food>;
}

export interface NormalisedName {
  name: string;
  portions: Portion[];
}
export interface EnrichmentRepository {
  normalisationCandidates(
    remoteOrigins: string[],
    spaceIds: string[],
    limit: number,
    includeCache?: boolean,
  ): Promise<Food[]>;
  setNormalisedName(
    row: Food,
    value: NormalisedName | null,
    spaceIds: string[],
    emit: EmitFn,
  ): Promise<void>;
  embeddingCandidates(spaceId: string | null, revision: string, limit: number): Promise<Food[]>;
  setEmbeddings(rows: FoodEmbedding[]): Promise<void>;
}
