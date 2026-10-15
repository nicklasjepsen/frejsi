import { Food, FoodCandidate } from "../schemas/food";
import { foldForSearch } from "./search";
import { CacheFoodInput, type FoodRepository, type LibraryOptions } from "./types";

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
