// The browser side of the foods routes (plan §7, task 4): one typed function per call, every
// response validated against the shared contracts, every failure a `LibraryApiError` carrying the
// stable ApiError code. The screens never write anything else: every write goes through these
// routes, whose services emit (CLAUDE.md "every write goes through emit").
//
// Schema modules, not the @frejsi/shared barrel: this runs in the browser, and the barrel also
// exports Prisma.
import { ApiError, type ApiErrorCode } from "@frejsi/shared/schemas/api";
import {
  FoodView,
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

/** Origins typed by a person: they fall under "Egne retter", not under an origin chip. */
export const OWN_ORIGINS: ReadonlySet<string> = new Set(["family", "manual"]);

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

const foods = (spaceId: string) => `/api/spaces/${encodeURIComponent(spaceId)}/foods`;
const one = (spaceId: string, foodId: string) => `${foods(spaceId)}/${encodeURIComponent(foodId)}`;

export const libraryApi = {
  list: async (
    spaceId: string,
    query: { filter: LibraryFilter; q: string },
    signal?: AbortSignal,
  ): Promise<FoodList> => {
    const params = new URLSearchParams({ filter: query.filter });
    const q = query.q.trim();
    if (q) params.set("q", q);
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
  /** The tick: `POST foods/verify`. The answer's body is not needed; success means verified. */
  verify: async (spaceId: string, foodIds: string[]): Promise<void> => {
    await send(`${foods(spaceId)}/verify`, { method: "POST", body: { foodIds } });
  },
  remove: async (spaceId: string, foodId: string): Promise<void> => {
    await send(one(spaceId, foodId), { method: "DELETE" });
  },
  /** Called only when the form is saved, never on preview (plan §6). */
  putPhoto: async (spaceId: string, foodId: string, jpeg: Uint8Array): Promise<FoodView | null> => {
    const response = await send(`${one(spaceId, foodId)}/photo`, { method: "PUT", bytes: jpeg });
    const parsed = FoodView.safeParse(await response.json().catch(() => null));
    return parsed.success ? parsed.data : null;
  },
};
