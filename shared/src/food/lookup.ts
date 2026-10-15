import type { SessionContext } from "../schemas/auth";
import {
  FoodCandidate,
  FoodView,
  LookupQuery,
  LookupResponse,
  type Food,
  type FoodSourceStatus,
  type LookupResult,
} from "../schemas/food";
import type { Locale } from "../schemas/settings";
import type { FoodRepository, FoodSource, FoodSourceResult } from "./types";

export interface LookupOptions {
  spaceId: string;
  session: Pick<SessionContext, "simpleMode">;
  query: { q: string; remote?: boolean } | { barcode: string };
  locale: Locale;
}

function candidateFromRow(row: Food): FoodCandidate {
  return FoodCandidate.parse({
    name: row.name,
    carbsPer100g: row.carbsPer100g,
    portions: row.portions,
    barcode: row.barcode,
    origin: row.origin,
    sourceRef: row.sourceRef,
  });
}
function libraryResult(row: Food): LookupResult {
  const food = FoodView.parse({
    id: row.id,
    name: row.name,
    carbsPer100g: row.carbsPer100g,
    portions: row.portions,
    barcode: row.barcode,
    origin: row.origin,
    verified: row.verified,
    verifiedBy: row.verifiedBy,
    favourite: row.favourite,
    updatedAt: row.updatedAt,
  });
  return { source: "library", verified: row.verified, food };
}

/** Bound even adapters that ignore cancellation; a late rejection is still handled by race. */
async function querySource(
  source: FoodSource,
  query: LookupQuery,
  locale: Locale,
): Promise<FoodSourceResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(async () => {
        const result =
          "barcode" in query
            ? await source.byBarcode(query.barcode, controller.signal)
            : await source.search(query.q, locale, controller.signal);
        if (result.status !== "ok") return { status: result.status, candidates: [] };
        return {
          status: result.status,
          candidates: result.candidates.map((candidate) =>
            FoodCandidate.parse({ ...candidate, origin: source.id }),
          ),
        };
      }),
      new Promise<FoodSourceResult>((resolve) => {
        timer = setTimeout(() => {
          resolve({ status: "timeout", candidates: [] });
          controller.abort();
        }, 2500);
      }),
    ]);
  } catch {
    return { status: "error", candidates: [] };
  } finally {
    clearTimeout(timer);
  }
}

export async function lookup(
  repo: FoodRepository,
  sources: FoodSource[],
  options: LookupOptions,
): Promise<LookupResponse> {
  const query = LookupQuery.parse(options.query);
  const { spaceId, session, locale } = options;
  const libraryOptions = { verifiedOnly: session.simpleMode };
  const library =
    "barcode" in query
      ? await repo.findLibraryByBarcode(spaceId, query.barcode, libraryOptions)
      : await repo.searchLibrary(spaceId, query.q, libraryOptions);
  const excluded = library.map((row) => row.sourceRef);
  const cache = session.simpleMode
    ? []
    : "barcode" in query
      ? await repo.findCacheByBarcode(query.barcode, excluded)
      : await repo.searchCache(query.q, excluded);
  const results: LookupResult[] = [
    ...library.map(libraryResult),
    ...cache.map((row) => ({ source: "cache", verified: false, food: candidateFromRow(row) })),
  ];
  const seen = new Set([...library, ...cache].map((row) => row.sourceRef));
  const statuses: Record<string, FoodSourceStatus> = {};
  const replies = await Promise.all(
    sources.map(async (source) => {
      const skipped =
        session.simpleMode ||
        ("q" in query && (query.q.length < 3 || (!query.remote && source.kind === "remote")));
      return skipped
        ? { status: "skipped" as const, candidates: [] }
        : querySource(source, query, locale);
    }),
  );
  for (const [i, source] of sources.entries()) {
    const reply = replies[i];
    if (!reply) continue;
    statuses[source.id] = reply.status;
    for (const candidate of reply.candidates) {
      let food = candidate;
      if ("barcode" in query && source.kind === "remote") {
        food = { ...candidate, barcode: query.barcode, sourceRef: `${source.id}:${query.barcode}` };
        await repo.upsertCache({ ...food, spaceId: null, verified: false });
      }
      if (seen.has(food.sourceRef)) continue;
      seen.add(food.sourceRef);
      results.push({ source: source.id, verified: false, food });
    }
  }
  return LookupResponse.parse({
    results,
    sources: statuses,
    manual: "q" in query ? { name: query.q } : { barcode: query.barcode },
  });
}
