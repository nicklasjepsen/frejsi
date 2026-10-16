// A fetch fake for the Bibliotek screens (plan §8): it serves the foods routes of task 4 from an
// in-memory list, validated against the shared Zod contracts, and records every call so a test can
// assert what the screen sent and when. Imported only from *.test.ts(x).
import { foldForSearch } from "@frejsi/shared/food/search";
import {
  CreateFoodRequest,
  FoodView,
  UpdateFoodRequest,
  VerifyFoodsRequest,
} from "@frejsi/shared/schemas/food";
import { z } from "zod";

import artboard from "./artboard-foods.json";

export interface RecordedCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

const OWN = new Set(["family", "manual"]);

function counts(foods: readonly FoodView[]): Record<string, number> {
  const result: Record<string, number> = {
    all: foods.length,
    unverified: foods.filter((food) => !food.verified).length,
    own: foods.filter((food) => OWN.has(food.origin)).length,
    favourites: foods.filter((food) => food.favourite).length,
    recent: 0,
  };
  for (const food of foods) {
    if (!OWN.has(food.origin)) result[food.origin] = (result[food.origin] ?? 0) + 1;
  }
  return result;
}

function matches(food: FoodView, filter: string, q: string): boolean {
  const words = foldForSearch(q).split(/\s+/).filter(Boolean);
  const name = foldForSearch(food.name);
  if (!words.every((word) => name.includes(word))) return false;
  switch (filter) {
    case "all":
      return true;
    case "unverified":
      return !food.verified;
    case "own":
      return OWN.has(food.origin);
    case "favourites":
      return food.favourite;
    case "recent":
      return false;
    default:
      return food.origin === filter;
  }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const error = (status: number, code: string) => json(status, { error: { code, message: code } });

export interface FakeFoodsApi {
  fetch: typeof fetch;
  calls: RecordedCall[];
  foods: FoodView[];
  /** Methods+paths ("POST foods", "PUT foods/:id/photo") that answer 500 until cleared. */
  failing: Set<string>;
  /** What `GET contributions` lists; empty by default, so nothing offers a send. */
  available: string[];
  /** The recorded calls with this method whose path matches. */
  callsTo(method: string, pathPattern: RegExp): RecordedCall[];
}

let nextId = 1;

export function fakeFoodsApi(initial: FoodView[], spaceId = "s1"): FakeFoodsApi {
  const api: FakeFoodsApi = {
    calls: [],
    foods: initial.map((food) => ({ ...food })),
    failing: new Set(),
    available: [],
    callsTo: (method, pattern) =>
      api.calls.filter((call) => call.method === method && pattern.test(call.path)),
    fetch: (input, init) =>
      Promise.resolve(
        serve(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          init,
        ),
      ),
  };
  function serve(input: string, init: RequestInit | undefined): Response {
    const url = new URL(input, "https://frejsi.example.invalid");
    const method = (init?.method ?? "GET").toUpperCase();
    const prefix = `/api/spaces/${spaceId}/`;
    if (!url.pathname.startsWith(prefix)) return error(404, "not-found");
    const path = url.pathname.slice(prefix.length);
    let body: unknown = undefined;
    if (init?.body instanceof Uint8Array || init?.body instanceof Blob) body = init.body;
    else if (typeof init?.body === "string") body = JSON.parse(init.body) as unknown;
    api.calls.push({ method, path, query: Object.fromEntries(url.searchParams), body });
    const key = `${method} ${path.replace(/^foods\/(?!verify)[^/]+/, "foods/:id")}`;
    if (api.failing.has(key)) return error(500, "internal");

    if (path === "contributions") {
      if (method === "GET") return json(200, { available: api.available });
      const sent = body as { foodId?: string } | undefined;
      const target = api.foods.find((row) => row.id === sent?.foodId);
      if (!target || !api.available.includes(target.origin)) return error(404, "not-found");
      return json(200, { status: "ok" });
    }
    if (path === "foods" && method === "GET") {
      const filter = url.searchParams.get("filter") ?? "all";
      const q = url.searchParams.get("q") ?? "";
      return json(200, {
        foods: api.foods.filter((food) => matches(food, filter, q)),
        counts: counts(api.foods),
      });
    }
    if (path === "foods" && method === "POST") {
      const { from, verify, ...rest } = body as Record<string, unknown>;
      if (from !== "library") return error(400, "validation");
      const parsed = CreateFoodRequest.safeParse(rest);
      if (!parsed.success) return error(400, "validation");
      const food: FoodView = {
        id: `f-new-${nextId++}`,
        name: parsed.data.name,
        ...(parsed.data.carbsPer100g == null ? {} : { carbsPer100g: parsed.data.carbsPer100g }),
        portions: parsed.data.portions,
        origin: "family",
        verified: verify === true,
        favourite: parsed.data.favourite ?? false,
        createdAt: "2026-10-15T12:00:00.000Z",
        updatedAt: "2026-10-15T12:00:00.000Z",
      };
      api.foods.push(food);
      return json(201, food);
    }
    if (path === "foods/verify" && method === "POST") {
      const parsed = VerifyFoodsRequest.safeParse(body);
      if (!parsed.success) return error(400, "validation");
      for (const id of parsed.data.foodIds) {
        const food = api.foods.find((row) => row.id === id);
        if (!food) return error(404, "not-found");
        food.verified = true;
      }
      return json(200, { verified: parsed.data.foodIds });
    }
    const one = /^foods\/([^/]+)(\/photo)?$/.exec(path);
    const food = one ? api.foods.find((row) => row.id === one[1]) : undefined;
    if (!one || !food) return error(404, "not-found");
    if (one[2]) {
      if (method !== "PUT") return error(405, "validation");
      food.photo = {
        thumbUrl: `https://photos.example.invalid/${food.id}/thumb.jpg`,
        originalUrl: `https://photos.example.invalid/${food.id}/original.jpg`,
      };
      return json(200, food);
    }
    if (method === "GET") return json(200, food);
    if (method === "DELETE") {
      api.foods = api.foods.filter((row) => row.id !== food.id);
      return new Response(null, { status: 204 });
    }
    if (method === "PATCH") {
      const parsed = UpdateFoodRequest.safeParse(body);
      if (!parsed.success) return error(400, "validation");
      const { carbsPer100g, ...rest } = parsed.data;
      Object.assign(food, rest);
      if (carbsPer100g === null) delete food.carbsPer100g;
      else if (carbsPer100g !== undefined) food.carbsPer100g = carbsPer100g;
      return json(200, food);
    }
    return error(405, "validation");
  }
  return api;
}

/** The artboard's foods (Bibliotek-Telefon), with fictional barcodes in the 20… range. */
export function artboardFoods(): FoodView[] {
  return z.array(FoodView).parse(artboard);
}
