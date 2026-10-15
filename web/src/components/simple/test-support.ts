// A recording fetch fake for the picker and Nu's meal regions (plan §8): it serves `GET foods`,
// `GET day` and `POST meals` in the shapes of the shared Zod contracts, parses every body it is
// sent, and records every call so a test can assert what a screen sent. The real routes are
// exercised by components/meal/clients.routes.test.ts. Imported only from *.test.ts(x).
import { FoodView } from "@frejsi/shared/schemas/food";
import { CreateMealRequest, DayView, type DayMealView } from "@frejsi/shared/schemas/meal";

export interface RecordedCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const error = (status: number, code: string) => json(status, { error: { code, message: code } });

export const AT = "2026-10-15T10:13:00.000Z";

export function food(id: string, name: string, fields: Partial<FoodView> = {}): FoodView {
  return FoodView.parse({
    id,
    name,
    origin: "family",
    verified: true,
    favourite: false,
    portions: [{ label: "1 stk", carbs: 14 }],
    updatedAt: AT,
    ...fields,
  });
}

export function meal(
  id: string,
  ts: string,
  title: string,
  carbs: number,
  by = "Jonas",
): DayMealView {
  return {
    id,
    ts,
    title,
    slot: "lunch",
    totalCarbs: carbs,
    byUser: { id: `u-${by}`, name: by },
    items: [{ name: title, carbs }],
  };
}

export interface FakeApi {
  fetch: typeof fetch;
  calls: RecordedCall[];
  foods: FoodView[];
  /** Ids of foods eaten in the last 30 days, newest first. */
  recent: string[];
  meals: DayMealView[];
  /** As the route does for a simpleMode session: verified foods only. */
  simpleMode: boolean;
  /** "METHOD path-suffix" pairs that answer 500, e.g. "POST meals", "GET day". */
  failing: Set<string>;
}

export function fakeApi(
  init: Partial<Pick<FakeApi, "foods" | "recent" | "meals" | "simpleMode">> = {},
): FakeApi {
  const api: FakeApi = {
    calls: [],
    foods: init.foods ?? [],
    recent: init.recent ?? [],
    meals: init.meals ?? [],
    simpleMode: init.simpleMode ?? false,
    failing: new Set(),
    fetch: async (input: RequestInfo | URL, init: RequestInit = {}) => {
      await Promise.resolve();
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        "https://frejsi.example",
      );
      const method = (init.method ?? "GET").toUpperCase();
      const body: unknown = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      const path = url.pathname.replace(/^\/api\/spaces\/s1\//, "");
      api.calls.push({ method, path, query: Object.fromEntries(url.searchParams), body });
      if (api.failing.has(`${method} ${path}`)) return error(500, "internal");
      if (method === "GET" && path === "foods") {
        const visible = api.simpleMode ? api.foods.filter((f) => f.verified) : api.foods;
        const filter = url.searchParams.get("filter") ?? "all";
        const foods =
          filter === "recent"
            ? api.recent.flatMap((id) => visible.filter((f) => f.id === id))
            : filter === "unverified"
              ? visible.filter((f) => !f.verified)
              : filter === "favourites"
                ? visible.filter((f) => f.favourite)
                : visible;
        const counts = {
          all: visible.length,
          unverified: visible.filter((f) => !f.verified).length,
          own: visible.length,
          favourites: visible.filter((f) => f.favourite).length,
          recent: api.recent.length,
        };
        return json(200, { foods: foods.map((f) => FoodView.parse(f)), counts });
      }
      if (method === "GET" && path === "day") {
        const meals = [...api.meals].sort((a, b) => b.ts.localeCompare(a.ts));
        return json(
          200,
          DayView.parse({
            date: "2026-10-15",
            timezone: "Europe/Copenhagen",
            totalCarbs: meals.reduce((sum, m) => sum + m.totalCarbs, 0),
            mealCount: meals.length,
            ...(meals[0] ? { lastMealAt: meals[0].ts } : {}),
            meals,
          }),
        );
      }
      if (method === "POST" && path === "meals") {
        const parsed = CreateMealRequest.safeParse(body);
        if (!parsed.success) return error(400, "validation");
        if (api.simpleMode && parsed.data.bolusTs !== undefined) return error(400, "simple-mode");
        return json(201, { id: "m-new" });
      }
      return error(404, "not-found");
    },
  };
  return api;
}
