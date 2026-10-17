import { mergeSemantic } from "../ai/search/rank";
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
import type { FoodRepository, FoodSource, FoodSourceResult, SearchEmbed } from "./types";

export interface LookupOptions {
  spaceId: string;
  session: Pick<SessionContext, "simpleMode">;
  query: { q: string; remote?: boolean } | { barcode: string };
  locale: Locale;
  embed?: SearchEmbed | null;
  photo?: (key: string) => Promise<NonNullable<FoodView["photo"]>>;
}

function candidateFromRow(row: Food): FoodCandidate {
  return FoodCandidate.parse({
    name: row.name,
    carbsPer100g: row.carbsPer100g,
    portions: row.portions,
    barcode: row.barcode,
    origin: row.origin,
    sourceRef: row.sourceRef,
    category: row.category,
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
    createdAt: row.createdAt,
    sourceName: row.sourceName ?? undefined,
    createdBy: row.creator ?? undefined,
    category: row.category,
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
  let library =
    "barcode" in query
      ? await repo.findLibraryByBarcode(spaceId, query.barcode, libraryOptions)
      : await repo.searchLibrary(spaceId, query.q, libraryOptions);
  const excluded = library.map((row) => row.sourceRef);
  let cache = session.simpleMode
    ? []
    : "barcode" in query
      ? await repo.findCacheByBarcode(query.barcode, excluded)
      : await repo.searchCache(query.q, excluded);
  const statuses: Record<string, FoodSourceStatus> = {};
  if (options.embed !== undefined) {
    statuses.semantic = "skipped";
    if (options.embed && "q" in query && query.remote && query.q.length >= 3) {
      const embedding = await options.embed(query.q).catch(() => null);
      if (embedding) {
        const [own, shared] = await Promise.all([
          repo.searchLibrarySemantic(
            spaceId,
            embedding.vector,
            embedding.model,
            20,
            libraryOptions,
          ),
          session.simpleMode ? [] : repo.searchCacheSemantic(embedding.vector, embedding.model, 10),
        ]);
        library = mergeSemantic(library, own);
        const ownedRefs = new Set(library.map((food) => food.sourceRef));
        cache = mergeSemantic(cache, shared).filter((food) => !ownedRefs.has(food.sourceRef));
        statuses.semantic = "ok";
      }
    }
  }
  const results: LookupResult[] = [
    ...(await Promise.all(
      library.map(async (row) => {
        const result = libraryResult(row);
        if (row.photoKey && options.photo)
          result.food = FoodView.parse({
            ...result.food,
            photo: await options.photo(row.photoKey),
          });
        return result;
      }),
    )),
    ...cache.map((row) => ({ source: "cache", verified: false, food: candidateFromRow(row) })),
  ];
  const seen = new Set([...library, ...cache].map((row) => row.sourceRef));
  const replies = await Promise.all(
    sources.map(async (source) => {
      const skipped =
        session.simpleMode ||
        ("barcode" in query &&
          source.kind === "remote" &&
          seen.has(`${source.id}:${query.barcode}`)) ||
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
      }
      if (seen.has(food.sourceRef)) continue;
      if ("barcode" in query && source.kind === "remote") {
        await repo.upsertCache({ ...food, spaceId: null, verified: false });
      }
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
