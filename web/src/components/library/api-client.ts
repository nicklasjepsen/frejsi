// The browser side of the foods routes (plan §7, task 4): one typed function per call, every
// response validated against the shared contracts, every failure a `LibraryApiError` carrying the
// stable ApiError code. The screens never write anything else: every write goes through these
// routes, whose services emit (CLAUDE.md "every write goes through emit").
//
// Schema modules, not the @frejsi/shared barrel: this runs in the browser, and the barrel also
// exports Prisma.
import { ApiError, type ApiErrorCode } from "@frejsi/shared/schemas/api";
import {
  ContributionsView,
  FoodView,
  LookupResponse,
  type CreateFoodRequest,
  type UpdateFoodRequest,
} from "@frejsi/shared/schemas/food";
import { z } from "zod";

export class LibraryApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
  ) {
    super(code);
    this.name = "LibraryApiError";
  }
}

/** The fixed filters; any other value is an origin id (`off`, `frida`, a future plugin). */
export const FIXED_FILTERS = ["all", "unverified", "own", "favourites", "recent"] as const;
export type FixedFilter = (typeof FIXED_FILTERS)[number];
export type LibraryFilter = FixedFilter | (string & {});

/** Origins a person made here (a dish from a recipe too): "Egne retter", never an origin chip. */
export const OWN_ORIGINS: ReadonlySet<string> = new Set(["family", "manual", "recipe"]);

/**
 * `GET foods`: the space's foods with the counts per filter. A bare `FoodView[]` is accepted too;
 * the screen then derives the counts from an unfiltered list.
 */
const FoodListBody = z.union([
  z.array(FoodView).transform((foods) => ({ foods, counts: undefined })),
  z
    .object({
      foods: z.array(FoodView),
      counts: z.record(z.string(), z.number().int().min(0)).optional(),
    })
    .transform(({ foods, counts }) => ({ foods, counts })),
]);
export interface FoodList {
  foods: FoodView[];
  counts: Record<string, number> | undefined;
}

interface Init {
  method: string;
  body?: unknown;
  bytes?: Uint8Array;
  signal?: AbortSignal;
}

async function send(path: string, init: Init): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json" };
  let body: BodyInit | undefined;
  if (init.bytes !== undefined) {
    headers["content-type"] = "image/jpeg";
    body = new Blob([init.bytes as Uint8Array<ArrayBuffer>], { type: "image/jpeg" });
  } else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const response = await fetch(path, {
    method: init.method,
    headers,
    credentials: "same-origin",
    ...(body === undefined ? {} : { body }),
    ...(init.signal ? { signal: init.signal } : {}),
  });
  if (response.ok) return response;
  let code: ApiErrorCode = "internal";
  try {
    const parsed = ApiError.safeParse(await response.json());
    if (parsed.success) code = parsed.data.error.code;
  } catch {
    // Not JSON: a gateway page. The code stays internal.
  }
  throw new LibraryApiError(response.status, code);
}

async function callJson<T>(path: string, init: Init, schema: z.ZodType<T>): Promise<T> {
  const response = await send(path, init);
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new LibraryApiError(response.status, "internal");
  return parsed.data;
}

/** `GET foods` answers 400 to a `q` longer than 80 characters; a longer paste searches its start. */
const MAX_QUERY = 80;
const searchText = (q: string) => q.trim().slice(0, MAX_QUERY).trim();

/** `VerifyFoodsRequest.foodIds` holds 1–50 ids. */
const VERIFY_BATCH = 50;

const foods = (spaceId: string) => `/api/spaces/${encodeURIComponent(spaceId)}/foods`;
const one = (spaceId: string, foodId: string) => `${foods(spaceId)}/${encodeURIComponent(foodId)}`;

export const libraryApi = {
  list: async (
    spaceId: string,
    query: { filter: LibraryFilter; q: string; mode?: "keyword" | "semantic" },
    signal?: AbortSignal,
  ): Promise<FoodList> => {
    const params = new URLSearchParams({ filter: query.filter });
    const q = searchText(query.q);
    if (q) params.set("q", q);
    if (query.mode === "semantic") params.set("mode", "semantic");
    return callJson(
      `${foods(spaceId)}?${params.toString()}`,
      { method: "GET", ...(signal ? { signal } : {}) },
      FoodListBody,
    );
  },
  get: (spaceId: string, foodId: string) =>
    callJson(one(spaceId, foodId), { method: "GET" }, FoodView),
  /**
   * A food typed in the library: the route sets `origin: "family"` from `from: "library"` and
   * `verified: false`. `verify: true` is "Gem og godkend": the explicit tick, made by the route in
   * the same request with its own event. The body never carries `verified`.
   */
  create: (spaceId: string, fields: CreateFoodRequest, options: { verify: boolean }) =>
    callJson(
      foods(spaceId),
      {
        method: "POST",
        body: { ...fields, from: "library", ...(options.verify ? { verify: true } : {}) },
      },
      FoodView,
    ),
  update: (spaceId: string, foodId: string, fields: UpdateFoodRequest) =>
    callJson(one(spaceId, foodId), { method: "PATCH", body: fields }, FoodView),
  /**
   * The tick: `POST foods/verify`, in requests of at most 50 ids (the contract's limit). The
   * answer's body is not needed; success means verified.
   */
  verify: async (spaceId: string, foodIds: string[]): Promise<void> => {
    for (let start = 0; start < foodIds.length; start += VERIFY_BATCH) {
      await send(`${foods(spaceId)}/verify`, {
        method: "POST",
        body: { foodIds: foodIds.slice(start, start + VERIFY_BATCH) },
      });
    }
  },
  remove: async (spaceId: string, foodId: string): Promise<void> => {
    await send(one(spaceId, foodId), { method: "DELETE" });
  },
  /** Which plugins can receive a correction on this deployment (ids only). */
  contributions: async (spaceId: string): Promise<string[]> =>
    (
      await callJson(
        `/api/spaces/${encodeURIComponent(spaceId)}/contributions`,
        { method: "GET" },
        ContributionsView,
      )
    ).available,
  /** "Send rettelsen": only ever called from a ticked box, after the food itself was saved. */
  sendCorrection: async (spaceId: string, foodId: string): Promise<void> => {
    await send(`/api/spaces/${encodeURIComponent(spaceId)}/contributions`, {
      method: "POST",
      body: { foodId },
    });
  },
  /** Called only when the form is saved, never on preview (plan §6). */
  putPhoto: async (spaceId: string, foodId: string, jpeg: Uint8Array): Promise<FoodView | null> => {
    const response = await send(`${one(spaceId, foodId)}/photo`, { method: "PUT", bytes: jpeg });
    const parsed = FoodView.safeParse(await response.json().catch(() => null));
    return parsed.success ? parsed.data : null;
  },
};

/** Submit adapter for the simple-picker lane: verified own foods with pickable portions only.
 * Call on the explicit submit action; typing stays local in the picker. */
export async function lookupVerifiedFoods(
  spaceId: string,
  query: string,
  signal?: AbortSignal,
): Promise<FoodView[]> {
  const q = searchText(query);
  if (q.length < 3) return [];
  const params = new URLSearchParams({ q, remote: "true" });
  const body = await callJson(
    `/api/spaces/${encodeURIComponent(spaceId)}/lookup?${params.toString()}`,
    { method: "GET", ...(signal ? { signal } : {}) },
    LookupResponse,
  );
  const seen = new Set<string>();
  return body.results.flatMap((result) => {
    if (result.source !== "library" || !result.verified) return [];
    const parsed = FoodView.safeParse(result.food);
    if (
      !parsed.success ||
      !parsed.data.verified ||
      !parsed.data.portions.length ||
      seen.has(parsed.data.id)
    )
      return [];
    seen.add(parsed.data.id);
    return [parsed.data];
  });
}
