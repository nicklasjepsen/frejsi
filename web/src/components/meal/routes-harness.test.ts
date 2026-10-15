// @vitest-environment node
// The browser clients wired straight into the real route handlers: `fetch` is replaced by a
// dispatcher that builds a `Request` with the session cookie and calls the exported GET/POST/…
// of `app/api/spaces/[spaceId]/{foods,lookup,meals,day}`, which run the real services over the
// in-memory fakes their own route tests use. No fetch fake answers for a route here, so a
// mismatch between what a screen sends and what a route accepts fails these tests (issue #40).
// Exported for `clients.routes.test.ts`; the one test below checks the dispatcher itself.
import {
  EventEnvelope,
  EventPayloads,
  Food,
  PrismaFoodRepository,
  type EmitFn,
} from "@frejsi/shared";
import { MemoryPhotoStore } from "@frejsi/shared/photos/memory";
import { expect, it, vi } from "vitest";

import { GET as dayGet } from "@/app/api/spaces/[spaceId]/day/route";
import { configureDay, type DayDb } from "@/app/api/spaces/[spaceId]/day/load-day";
import { GET as foodsGet, POST as foodsPost } from "@/app/api/spaces/[spaceId]/foods/route";
import {
  DELETE as foodDelete,
  GET as foodGet,
  PATCH as foodPatch,
} from "@/app/api/spaces/[spaceId]/foods/[foodId]/route";
import {
  DELETE as foodPhotoDelete,
  PUT as foodPhotoPut,
} from "@/app/api/spaces/[spaceId]/foods/[foodId]/photo/route";
import { POST as foodsVerify } from "@/app/api/spaces/[spaceId]/foods/verify/route";
import { GET as lookupGet } from "@/app/api/spaces/[spaceId]/lookup/route";
import { configureLookup } from "@/app/api/spaces/[spaceId]/lookup/server";
import { POST as mealsPost } from "@/app/api/spaces/[spaceId]/meals/route";
import {
  DELETE as mealDelete,
  GET as mealGet,
  PATCH as mealPatch,
} from "@/app/api/spaces/[spaceId]/meals/[mealId]/route";
import {
  DELETE as mealPhotoDelete,
  PUT as mealPhotoPut,
} from "@/app/api/spaces/[spaceId]/meals/[mealId]/photo/route";
import { configureFoods } from "@/lib/foods/core";
import { foodTestRig, T0 } from "@/lib/foods/test-fixture.test";
import { FakeLiveDb } from "@/lib/live/test-support";
import type { MealRecord, MealRepository } from "@/lib/meals/repository";
import { configureMeals } from "@/lib/meals/server";

export { T0 };
export const ORIGIN = "https://frejsi.example";
/** A 2×2 grey JPEG: the photo routes decode what they store. */
export const JPEG = Uint8Array.from(
  Buffer.from(
    "/9j/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKAA/9k=",
    "base64",
  ),
);

/** carer: an adult; child: a carer with simpleMode; viewer: sees the day only. */
export type Member = "carer" | "child" | "viewer";

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;
interface Route {
  pattern: RegExp;
  keys: string[];
  methods: Partial<Record<string, Handler>>;
}
const route = (pattern: RegExp, keys: string[], methods: Record<string, unknown>): Route => ({
  pattern,
  keys,
  methods: methods as Route["methods"],
});

const ROUTES: Route[] = [
  route(/^\/api\/spaces\/([^/]+)\/foods$/, ["spaceId"], { GET: foodsGet, POST: foodsPost }),
  route(/^\/api\/spaces\/([^/]+)\/foods\/verify$/, ["spaceId"], { POST: foodsVerify }),
  route(/^\/api\/spaces\/([^/]+)\/foods\/([^/]+)\/photo$/, ["spaceId", "foodId"], {
    PUT: foodPhotoPut,
    DELETE: foodPhotoDelete,
  }),
  route(/^\/api\/spaces\/([^/]+)\/foods\/([^/]+)$/, ["spaceId", "foodId"], {
    GET: foodGet,
    PATCH: foodPatch,
    DELETE: foodDelete,
  }),
  route(/^\/api\/spaces\/([^/]+)\/lookup$/, ["spaceId"], { GET: lookupGet }),
  route(/^\/api\/spaces\/([^/]+)\/meals$/, ["spaceId"], { POST: mealsPost }),
  route(/^\/api\/spaces\/([^/]+)\/meals\/([^/]+)\/photo$/, ["spaceId", "mealId"], {
    PUT: mealPhotoPut,
    DELETE: mealPhotoDelete,
  }),
  route(/^\/api\/spaces\/([^/]+)\/meals\/([^/]+)$/, ["spaceId", "mealId"], {
    GET: mealGet,
    PATCH: mealPatch,
    DELETE: mealDelete,
  }),
  route(/^\/api\/spaces\/([^/]+)\/day$/, ["spaceId"], { GET: dayGet }),
];

type Row = Record<string, unknown>;

/** A space food row of the foods rig as the shared `Food`, the way the Prisma adapter reads it. */
function foodOf(row: Row): Food {
  return Food.parse({
    ...row,
    carbsPer100g: row.carbsPer100g == null ? undefined : Number(row.carbsPer100g),
    portions: JSON.parse(String(row.portions)) as unknown,
    barcode: row.barcode ?? undefined,
    photoKey: row.photoKey ?? undefined,
    verifiedBy: row.verifiedBy ?? undefined,
    verifiedAt: row.verifiedAt instanceof Date ? row.verifiedAt.toISOString() : undefined,
    createdBy: row.createdBy ?? undefined,
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString(),
  });
}

export function realRoutes() {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  const rig = foodTestRig();
  const live = new FakeLiveDb(() => T0);
  live.addSpace("s1");
  live.addMember("carer", "s1", "carer");
  live.addMember("child", "s1", "carer");
  live.addMember("viewer", "s1", "viewer");
  for (const user of live.users) user.name = { carer: "Jonas", child: "Alma" }[user.id] ?? "Lone";
  const simpleMode = new Set<string>(["child"]);
  const sessionDb = live.db;
  const findSession = sessionDb.session.findUnique.bind(sessionDb.session);
  sessionDb.session.findUnique = (async (args: { where: { id: string } }) => {
    const row = (await findSession(args as never)) as { user: Row } | null;
    return row
      ? { ...row, user: { ...row.user, simpleMode: simpleMode.has(String(row.user.id)) } }
      : null;
  }) as unknown as typeof sessionDb.session.findUnique;

  const photos = new MemoryPhotoStore();
  const events: string[] = [];
  const meals = new Map<string, MealRecord>();
  const userName = (id: string) => live.users.find((u) => u.id === id)?.name ?? id;
  const syncItems = () => {
    // The foods rig answers "recently eaten" from its meal items.
    rig.items = [...meals.values()].flatMap((meal) =>
      meal.items.map((item) => ({
        foodId: item.foodId ?? null,
        name: item.name,
        carbs: item.carbs,
        meal: { spaceId: meal.spaceId, ts: new Date(meal.ts) },
      })),
    );
  };
  const repo: MealRepository = {
    food: (spaceId, id) => {
      const row = rig.rows.find((r) => r.id === id && r.spaceId === spaceId);
      return Promise.resolve(row ? foodOf(row) : null);
    },
    find: (spaceId, id) => {
      const row = meals.get(id);
      return Promise.resolve(row?.spaceId === spaceId ? row : null);
    },
    lock: async (spaceId, id) => {
      const row = await repo.find(spaceId, id);
      if (!row) throw Object.assign(new Error("not-found"), { code: "not-found" });
      return row;
    },
    create: (data) => {
      const row: MealRecord = {
        ...data,
        byUser: { id: data.byUserId, name: userName(data.byUserId) },
        timezone: "Europe/Copenhagen",
      };
      meals.set(row.id, row);
      syncItems();
      return Promise.resolve(row);
    },
    update: (spaceId, id, data) => {
      const previous = meals.get(id);
      if (previous?.spaceId !== spaceId) throw new Error("missing");
      const row: MealRecord = {
        ...previous,
        ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
      };
      meals.set(id, row);
      syncItems();
      return Promise.resolve(row);
    },
    delete: (_spaceId, id) => {
      meals.delete(id);
      syncItems();
      return Promise.resolve();
    },
  };
  const emit: EmitFn = (spaceId, type, payload) => {
    events.push(type);
    return Promise.resolve(
      EventEnvelope.parse({
        spaceId,
        seq: events.length,
        type,
        payload: EventPayloads[type].parse(payload),
        ts: T0.toISOString(),
      }),
    );
  };
  const dayDb = {
    ...(sessionDb as unknown as Row),
    meal: {
      findMany: (args: { where: { spaceId: string; ts: { gte: Date; lt: Date } } }) =>
        Promise.resolve(
          [...meals.values()]
            .filter((meal) => {
              const at = new Date(meal.ts).getTime();
              return (
                meal.spaceId === args.where.spaceId &&
                at >= args.where.ts.gte.getTime() &&
                at < args.where.ts.lt.getTime()
              );
            })
            .sort((a, b) => b.ts.localeCompare(a.ts))
            .map((meal) => ({
              id: meal.id,
              ts: new Date(meal.ts),
              totalCarbs: meal.totalCarbs,
              photoKey: meal.photoKey ?? null,
              byUser: meal.byUser,
              items: meal.items.map((item) => ({
                name: item.name,
                portionLabel: item.portionLabel ?? null,
                grams: item.grams ?? null,
                carbs: item.carbs,
              })),
            })),
        ),
    },
  } as unknown as DayDb;

  configureFoods({ ...rig.deps, sessionDb, photos });
  configureMeals({ sessionDb, repo, photos, write: (work) => work(repo, emit), now: () => T0 });
  configureLookup({
    sessionDb,
    repo: new PrismaFoodRepository(rig.deps.db),
    sources: rig.deps.sources ?? [],
    photos,
  });
  configureDay({ db: dayDb, photos, now: () => T0 });

  let member: Member = "carer";
  /** Every request the clients made, as "METHOD /path?query". */
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      ORIGIN,
    );
    const method = (init.method ?? "GET").toUpperCase();
    calls.push(`${method} ${url.pathname}${url.search}`);
    const headers = new Headers(init.headers);
    headers.set("cookie", `frejsi_session=sess-${member}`);
    const request = new Request(url, {
      method,
      headers,
      ...(init.body === undefined || init.body === null ? {} : { body: init.body }),
      ...(init.signal ? { signal: init.signal } : {}),
    });
    for (const candidate of ROUTES) {
      const match = candidate.pattern.exec(url.pathname);
      if (!match) continue;
      const handler = candidate.methods[method];
      if (!handler) return new Response(null, { status: 405 });
      const params = Object.fromEntries(
        candidate.keys.map((key, i) => [key, decodeURIComponent(match[i + 1] ?? "")]),
      );
      return handler(request, { params: Promise.resolve(params as never) });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  vi.stubGlobal("fetch", fetchImpl);

  return {
    rig,
    meals,
    events,
    calls,
    photos,
    fetch: fetchImpl,
    as(next: Member) {
      member = next;
    },
    /** A space food row with portions given as objects. */
    food(data: Row & { id: string; name: string; portions?: unknown[] }) {
      return rig.seed({
        ...data,
        portions: JSON.stringify(data.portions ?? []),
        nameSearch: data.name.toLowerCase(),
        sourceRef: `family:${data.id}`,
      });
    },
    reset() {
      rig.reset();
      configureMeals({});
      configureLookup({});
      configureDay({});
      vi.unstubAllGlobals();
      vi.useRealTimers();
    },
  };
}

it("dispatches to the real handlers with the member's session and answers 404 elsewhere", async () => {
  const routes = realRoutes();
  try {
    routes.as("viewer");
    expect((await fetch("/api/spaces/s1/foods")).status).toBe(403);
    expect((await fetch("/api/spaces/s1/day")).status).toBe(200);
    expect((await fetch("/api/spaces/s1/nowhere")).status).toBe(404);
    expect(routes.calls).toEqual([
      "GET /api/spaces/s1/foods",
      "GET /api/spaces/s1/day",
      "GET /api/spaces/s1/nowhere",
    ]);
  } finally {
    routes.reset();
  }
});
