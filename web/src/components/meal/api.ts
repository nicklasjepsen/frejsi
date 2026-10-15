// The browser side of the routes the log screen writes through: task 4's foods routes and task 6's
// lookup and meals routes (plan §7). Every write goes through them, so every write emits; nothing
// here touches the database. Schema modules, not the @frejsi/shared barrel: this is bundled for the
// browser, and the barrel also exports Prisma and the Azure clients.
import { ApiError, type ApiErrorCode } from "@frejsi/shared/schemas/api";
import {
  CreateFoodRequest,
  FoodView,
  LookupResponse,
  type FoodCandidate,
} from "@frejsi/shared/schemas/food";
import { MealView, type CreateMealRequest } from "@frejsi/shared/schemas/meal";
import { z } from "zod";

export class LogApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
  ) {
    super(code);
    this.name = "LogApiError";
  }
}

const base = (spaceId: string) => `/api/spaces/${encodeURIComponent(spaceId)}`;

async function send(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      headers,
      credentials: "same-origin",
      ...(init.signal ? { signal: init.signal } : {}),
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new LogApiError(0, "internal");
  }
  if (response.ok) return response;
  let code: ApiErrorCode = "internal";
  try {
    const parsed = ApiError.safeParse(await response.json());
    if (parsed.success) code = parsed.data.error.code;
  } catch {
    // Not JSON: a gateway page. The code stays internal.
  }
  throw new LogApiError(response.status, code);
}

async function body<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new LogApiError(response.status, "internal");
  return parsed.data;
}

/** A food answer, bare or wrapped as `{ food }`. */
const OneFood = z.union([FoodView, z.object({ food: FoodView }).transform((value) => value.food)]);
/** The foods list, bare or as `{ foods, counts }` (task 4 adds the counts the library shows). */
const FoodList = z.union([
  z.array(FoodView),
  z.object({ foods: z.array(FoodView) }).transform((value) => value.foods),
]);

/** Library, cache and `local` sources as the user types (`remote: false`), all sources on submit. */
export async function lookupText(
  spaceId: string,
  q: string,
  remote: boolean,
  signal?: AbortSignal,
): Promise<LookupResponse> {
  const query = new URLSearchParams({ q, remote: String(remote) });
  return body(
    await send(`${base(spaceId)}/lookup?${query.toString()}`, signal ? { signal } : {}),
    LookupResponse,
  );
}

/** A barcode that has already passed `normaliseBarcode`. */
export async function lookupBarcode(
  spaceId: string,
  barcode: string,
  signal?: AbortSignal,
): Promise<LookupResponse> {
  const query = new URLSearchParams({ barcode });
  return body(
    await send(`${base(spaceId)}/lookup?${query.toString()}`, signal ? { signal } : {}),
    LookupResponse,
  );
}

export type FoodFilter = "all" | "favourites" | "recent";

export async function listFoods(spaceId: string, filter: FoodFilter): Promise<FoodView[]> {
  const query = new URLSearchParams({ filter });
  return body(await send(`${base(spaceId)}/foods?${query.toString()}`), FoodList);
}

/** A plugin or cache result into the space library, `verified: false` (task 4's `addCandidate`). */
export async function pickCandidate(spaceId: string, candidate: FoodCandidate): Promise<FoodView> {
  return body(
    await send(`${base(spaceId)}/foods`, { method: "POST", body: { candidate } }),
    OneFood,
  );
}

/** "Jeg kender tallet selv": a `manual` food, `verified: false`; the route decides the origin. */
export async function createManualFood(
  spaceId: string,
  request: CreateFoodRequest,
): Promise<FoodView> {
  const parsed = CreateFoodRequest.parse(request);
  return body(
    await send(`${base(spaceId)}/foods`, { method: "POST", body: { from: "log", ...parsed } }),
    OneFood,
  );
}

export async function createMeal(spaceId: string, request: CreateMealRequest): Promise<void> {
  await send(`${base(spaceId)}/meals`, { method: "POST", body: request });
}

export async function getMeal(spaceId: string, mealId: string): Promise<MealView> {
  return body(await send(`${base(spaceId)}/meals/${encodeURIComponent(mealId)}`), MealView);
}

export async function updateMeal(
  spaceId: string,
  mealId: string,
  request: CreateMealRequest,
): Promise<void> {
  await send(`${base(spaceId)}/meals/${encodeURIComponent(mealId)}`, {
    method: "PATCH",
    body: request,
  });
}

export async function deleteMeal(spaceId: string, mealId: string): Promise<void> {
  await send(`${base(spaceId)}/meals/${encodeURIComponent(mealId)}`, { method: "DELETE" });
}
