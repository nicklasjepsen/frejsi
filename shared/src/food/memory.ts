import type { EmitFn } from "../events/emit";
import { Food, FoodCandidate } from "../schemas/food";
import { foldForSearch } from "./search";
import {
  CacheFoodInput,
  type FoodRepository,
  type NormalisedName,
  type FoodEmbedding,
  type LibraryOptions,
} from "./types";

/** In-memory repository for tests and seeds; includes an audit of every supported write. */
export class MemoryFoodRepository implements FoodRepository {
  readonly rows: Food[];
  readonly writes: { method: "upsertCache"; data: CacheFoodInput }[] = [];
  constructor(
    rows: Food[] = [],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.rows = structuredClone(rows);
  }
  normalisationCandidates(
    remoteOrigins: string[],
    spaceIds: string[],
    limit: number,
    includeCache = true,
  ): Promise<Food[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (row) =>
            !row.verified &&
            remoteOrigins.includes(row.origin) &&
            !["ai", "family", "manual"].includes(row.origin) &&
            row.sourceName == null &&
            (row.spaceId === null ? includeCache : spaceIds.includes(row.spaceId)),
        )
        .sort(
          (a, b) =>
            Number(a.spaceId !== null) - Number(b.spaceId !== null) || a.id.localeCompare(b.id),
        )
        .slice(0, limit)
        .map((row) => structuredClone(row)),
    );
  }
  async setNormalisedName(
    row: Food,
    value: NormalisedName | null,
    spaceIds: string[],
    emit: EmitFn,
  ): Promise<void> {
    const copies = this.rows.filter(
      (other) =>
        other.origin === row.origin &&
        other.sourceRef === row.sourceRef &&
        other.name === row.name &&
        other.sourceName == null &&
        (other.id === row.id || (other.spaceId !== null && spaceIds.includes(other.spaceId))),
    );
    for (const target of copies) {
      target.sourceName = row.name;
      if (value && !target.verified) {
        target.name = value.name;
        target.nameSearch = foldForSearch(value.name);
        if (!target.portions.length) target.portions = structuredClone(value.portions);
        if (row.name !== value.name) {
          this.embeddings.delete(target.id);
          target.embeddingModel = null;
        }
      }
      if (target.spaceId !== null)
        await emit(target.spaceId, "food.updated", { foodId: target.id });
    }
  }
  embeddingCandidates(spaceId: string | null, revision: string, limit: number): Promise<Food[]> {
    return Promise.resolve(
      this.rows
        .filter(
          (row) =>
            row.spaceId === spaceId &&
            (!this.embeddings.has(row.id) || !row.embeddingModel?.startsWith(revision)),
        )
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((row) => structuredClone(row)),
    );
  }
  readonly embeddings = new Map<string, { vector: number[]; model: string }>();
  setEmbeddings(rows: FoodEmbedding[]): Promise<void> {
    for (const input of rows) {
      const row = this.rows.find((row) => row.id === input.id);
      if (!row || (input.name !== undefined && row.name !== input.name)) continue;
      this.embeddings.set(row.id, { vector: [...input.vector], model: input.model });
      row.embeddingModel = input.model;
    }
    return Promise.resolve();
  }
  searchLibrarySemantic(
    spaceId: string,
    vector: number[],
    model: string,
    limit: number,
    options: LibraryOptions = {},
  ) {
    return Promise.resolve(this.semantic(this.library(spaceId, options), vector, model, limit));
  }
  searchCacheSemantic(vector: number[], model: string, limit: number) {
    return Promise.resolve(this.semantic(this.cache([]), vector, model, limit));
  }
  private semantic(rows: Food[], vector: number[], model: string, limit: number) {
    return rows
      .flatMap((food) => {
        const stored = this.embeddings.get(food.id);
        if (stored?.model !== model || stored.vector.length !== vector.length) return [];
        const dot = stored.vector.reduce((sum, n, i) => sum + n * (vector[i] ?? 0), 0);
        const norm = Math.hypot(...vector) * Math.hypot(...stored.vector);
        return norm ? [{ food, distance: 1 - dot / norm }] : [];
      })
      .sort((a, b) => a.distance - b.distance || a.food.id.localeCompare(b.food.id))
      .slice(0, limit);
  }
  searchLibrary(spaceId: string, q: string, options: LibraryOptions = {}): Promise<Food[]> {
    return Promise.resolve(
      this.library(spaceId, options)
        .filter((row) => this.matches(row, q))
        .slice(0, 20),
    );
  }
  findLibraryByBarcode(
    spaceId: string,
    barcode: string,
    options: LibraryOptions = {},
  ): Promise<Food[]> {
    return Promise.resolve(
      this.library(spaceId, options)
        .filter((row) => row.barcode === barcode)
        .slice(0, 20),
    );
  }
  searchCache(q: string, excludeSourceRefs: string[] = []): Promise<Food[]> {
    return Promise.resolve(
      this.cache(excludeSourceRefs)
        .filter((row) => this.matches(row, q))
        .slice(0, 10),
    );
  }
  findCacheByBarcode(barcode: string, excludeSourceRefs: string[] = []): Promise<Food[]> {
    return Promise.resolve(
      this.cache(excludeSourceRefs)
        .filter((row) => row.barcode === barcode)
        .slice(0, 10),
    );
  }
  upsertCache(input: CacheFoodInput): Promise<Food> {
    const { spaceId, verified, ...fields } = CacheFoodInput.parse(input);
    const candidate = FoodCandidate.parse(fields);
    this.writes.push({ method: "upsertCache", data: structuredClone(input) });
    const previous = this.rows.find(
      (row) => row.spaceId === null && row.sourceRef === candidate.sourceRef,
    );
    const ts = this.now().toISOString();
    const row = Food.parse({
      ...candidate,
      spaceId,
      verified,
      id: previous?.id ?? `cache-${candidate.sourceRef}`,
      nameSearch: foldForSearch(candidate.name),
      createdAt: previous?.createdAt ?? ts,
      updatedAt: ts,
    });
    if (previous) this.rows[this.rows.indexOf(previous)] = row;
    else this.rows.push(row);
    return Promise.resolve(structuredClone(row));
  }
  private library(spaceId: string, options: LibraryOptions): Food[] {
    return this.rows
      .filter((row) => row.spaceId === spaceId && (!options.verifiedOnly || row.verified))
      .sort(
        (a, b) =>
          Number(b.favourite) - Number(a.favourite) ||
          Number(b.verified) - Number(a.verified) ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id),
      );
  }
  private cache(excluded: string[]): Food[] {
    return this.rows
      .filter((row) => row.spaceId === null && !excluded.includes(row.sourceRef))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }
  private matches(row: Food, q: string): boolean {
    return foldForSearch(q)
      .split(/\s+/)
      .filter(Boolean)
      .every((word) => row.nameSearch.includes(word));
  }
}
