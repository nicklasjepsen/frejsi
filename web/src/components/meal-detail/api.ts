// The browser side of the two meal reads this screen makes (v0.3.0 plan §6): `GET meals/[id]/curve`
// for owners and carers, `GET meals/[id]` for the simpleMode view, which shows no glucose and so
// never asks for any; and "Det passer" on a pump meal, `PATCH meals/[id]` with `{ adopt: true }`
// (v0.7.0 plan §9). Answers are parsed with the strict contracts, so nothing the contract does
// not name reaches a screen. Schema modules, not the @frejsi/shared barrel: this is bundled for
// the browser.
import { ApiError, type ApiErrorCode } from "@frejsi/shared/schemas/api";
import { MealCurveView } from "@frejsi/shared/schemas/history";
import { MealView } from "@frejsi/shared/schemas/meal";
import type { z } from "zod";

export class MealDetailError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
  ) {
    super(code);
    this.name = "MealDetailError";
  }
}

const mealPath = (spaceId: string, mealId: string) =>
  `/api/spaces/${encodeURIComponent(spaceId)}/meals/${encodeURIComponent(mealId)}`;

async function read<T extends z.ZodType>(
  path: string,
  schema: T,
  signal?: AbortSignal,
  write?: { method: "PATCH"; body: unknown },
): Promise<z.infer<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...(write
        ? {
            method: write.method,
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify(write.body),
          }
        : { headers: { accept: "application/json" } }),
      credentials: "same-origin",
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new MealDetailError(0, "internal");
  }
  if (!response.ok) {
    let code: ApiErrorCode = "internal";
    try {
      const parsed = ApiError.safeParse(await response.json());
      if (parsed.success) code = parsed.data.error.code;
    } catch {
      // Not JSON: a gateway page. The code stays internal.
    }
    throw new MealDetailError(response.status, code);
  }
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new MealDetailError(response.status, "internal");
  return parsed.data;
}

/** The meal with its −1 h/+4 h readings, stats and earlier occurrences (owner, carer). */
export function fetchMealCurve(
  spaceId: string,
  mealId: string,
  signal?: AbortSignal,
): Promise<MealCurveView> {
  return read(`${mealPath(spaceId, mealId)}/curve`, MealCurveView, signal);
}

/** The meal alone, without glucose: the simpleMode view. */
export function fetchMeal(
  spaceId: string,
  mealId: string,
  signal?: AbortSignal,
): Promise<MealView> {
  return read(mealPath(spaceId, mealId), MealView, signal);
}

/** "Det passer": a person ticks a meal the pump record made, and it becomes an ordinary meal. */
export function adoptMeal(spaceId: string, mealId: string): Promise<MealView> {
  return read(mealPath(spaceId, mealId), MealView, undefined, {
    method: "PATCH",
    body: { adopt: true },
  });
}
