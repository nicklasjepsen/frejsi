// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  EventEnvelope,
  EventPayloads,
  Food,
  SessionContext,
  type EmitFn,
  type EventType,
} from "@frejsi/shared";
import { MemoryPhotoStore } from "@frejsi/shared/photos/memory";
import type { MealRecord, MealRepository } from "./repository";
import {
  createMeal,
  updateMeal,
  deleteMeal,
  getMeal,
  setMealPhoto,
  type MealDeps,
} from "./service";

const at = new Date("2026-10-15T05:15:00.000Z");
const session = SessionContext.parse({
  userId: "carer",
  name: "Fictional carer",
  simpleMode: false,
  accent: "olive",
  theme: "system",
  locale: "en",
  memberships: [{ spaceId: "s1", role: "carer" }],
});
const baseFood = Food.parse({
  id: "f1",
  spaceId: "s1",
  name: "Fictional toast",
  nameSearch: "fictional toast",
  sourceRef: "family:f1",
  origin: "family",
  verified: false,
  carbsPer100g: 41,
  portions: [{ label: "slice", grams: 30, carbs: 13 }],
  createdAt: at.toISOString(),
  updatedAt: at.toISOString(),
});
let rows: Map<string, MealRecord>;
let food: Food;
let repo: MealRepository;
let deps: MealDeps;
let photos: MemoryPhotoStore;
let events: { type: EventType; payload: unknown }[];
beforeEach(() => {
  rows = new Map();
  food = structuredClone(baseFood);
  events = [];
  photos = new MemoryPhotoStore();
  repo = {
    food: (spaceId, id) =>
      Promise.resolve(spaceId === food.spaceId && id === food.id ? structuredClone(food) : null),
    find: (spaceId, id) =>
      Promise.resolve(
        rows.get(id)?.spaceId === spaceId ? structuredClone(rows.get(id) ?? null) : null,
      ),
    lock: async (spaceId, id) => {
      const row = await repo.find(spaceId, id);
      if (!row) throw Object.assign(new Error("not-found"), { code: "not-found" });
      return row;
    },
    create: (data) => {
      const row = {
        ...structuredClone(data),
        byUser: { id: data.byUserId, name: session.name },
        timezone: "Europe/Copenhagen",
      };
      rows.set(data.id, row);
      return Promise.resolve(structuredClone(row));
    },
    update: (spaceId, id, data) => {
      const previous = rows.get(id);
      if (previous?.spaceId !== spaceId) throw new Error("not-found");
      const row = {
        ...previous,
        ...structuredClone(data),
        bolusTs: data.bolusTs === null ? undefined : (data.bolusTs ?? previous.bolusTs),
        ts: data.ts ?? previous.ts,
        items: data.items ?? previous.items,
        totalCarbs: data.totalCarbs ?? previous.totalCarbs,
      };
      rows.set(id, row);
      return Promise.resolve(structuredClone(row));
    },
    delete: (_spaceId, id) => {
      rows.delete(id);
      return Promise.resolve();
    },
  };
  const emit: EmitFn = (spaceId, type, payload) => {
    events.push({ type, payload: EventPayloads[type].parse(payload) });
    return Promise.resolve(
      EventEnvelope.parse({ spaceId, seq: events.length, type, payload, ts: at.toISOString() }),
    );
  };
  deps = { repo, photos, now: () => at, write: (work) => work(repo, emit) };
});

describe("meal services", () => {
  it("computes weighed and named portions, snapshots names, accepts manual carbs and emits once", async () => {
    const view = await createMeal(
      "s1",
      session,
      {
        items: [
          { foodId: "f1", name: "ignored", grams: 50, carbs: 999 },
          { foodId: "f1", name: "ignored", portionLabel: "slice", carbs: 999 },
          { name: "Fictional berries", carbs: 7 },
        ],
      },
      deps,
    );
    expect(view.totalCarbs).toBe(41);
    expect(view.ts).toBe(at.toISOString());
    expect(view.byUser.id).toBe("carer");
    expect(view.slot).toBe("breakfast");
    expect(view.items).toEqual([
      { name: "Fictional toast", grams: 50, carbs: 21 },
      { name: "Fictional toast", portionLabel: "slice", grams: 30, carbs: 13 },
      { name: "Fictional berries", carbs: 7 },
    ]);
    expect(view.title).toBe("Fictional toast, Fictional toast, and Fictional berries");
    expect(events).toEqual([
      { type: "meal.created", payload: { mealId: view.id, ts: at.toISOString(), totalCarbs: 41 } },
    ]);
    expect(food.verified).toBe(false);
    food.name = "Changed food";
    food.carbsPer100g = 99;
    expect(await getMeal("s1", view.id, session.locale, deps)).toEqual(view);
    expect(JSON.stringify(view.items)).not.toContain("foodId");
  });
  it("replaces items and preserves the original author and omitted fields", async () => {
    const created = await createMeal(
      "s1",
      session,
      { items: [{ name: "First", carbs: 5 }], note: "Fictional lunch", bolusTs: at.toISOString() },
      deps,
    );
    const updated = await updateMeal(
      "s1",
      created.id,
      { ...session, userId: "other" },
      { items: [{ name: "Second", carbs: 8 }] },
      deps,
    );
    expect(updated.items).toEqual([{ name: "Second", carbs: 8 }]);
    expect(updated.totalCarbs).toBe(8);
    expect(updated.byUser.id).toBe("carer");
    expect(updated.title).toBe("Fictional lunch");
    expect(updated.bolusTs).toBe(at.toISOString());
    expect(events.map((e) => e.type)).toEqual(["meal.created", "meal.updated"]);
  });
  it("rejects simpleMode timestamps, unverified food, other-space food and malformed quantities before writes", async () => {
    const input = { items: [{ name: "Manual", carbs: 5 }] };
    await expect(
      createMeal(
        "s1",
        { ...session, simpleMode: true },
        { ...input, bolusTs: at.toISOString() },
        deps,
      ),
    ).rejects.toMatchObject({ code: "simple-mode" });
    await expect(
      createMeal(
        "s1",
        { ...session, simpleMode: true },
        { items: [{ name: "ignored", foodId: "f1", grams: 20 }] },
        deps,
      ),
    ).rejects.toMatchObject({ code: "simple-mode" });
    await expect(
      createMeal("s2", session, { items: [{ name: "ignored", foodId: "f1", grams: 20 }] }, deps),
    ).rejects.toMatchObject({ code: "not-found" });
    await expect(
      createMeal("s1", session, { items: [{ name: "ignored", foodId: "f1", grams: 5000 }] }, deps),
    ).rejects.toMatchObject({ code: "validation" });
    expect(rows.size).toBe(0);
    expect(events).toHaveLength(0);
  });
  it("uses typed carbs only without a computable food amount, validates portions and retains snapshots on metadata edits", async () => {
    const saved = await createMeal(
      "s1",
      session,
      { items: [{ name: "ignored", foodId: "f1", carbs: 11 }] },
      deps,
    );
    expect(saved.items[0]).toEqual({ name: food.name, carbs: 11 });
    food.name = "New name";
    const edited = await updateMeal("s1", saved.id, session, { note: "A note" }, deps);
    expect(edited.items).toEqual(saved.items);
    await expect(
      updateMeal(
        "s1",
        saved.id,
        session,
        { items: [{ name: "ignored", foodId: "f1", portionLabel: "missing", carbs: 5 }] },
        deps,
      ),
    ).rejects.toMatchObject({ code: "validation" });
    expect(events).toHaveLength(2);
  });
  it("stores photos on save, replaces/removes them with one event and deletes with the meal", async () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
    expect(photos.photos.size).toBe(0);
    const meal = await createMeal(
      "s1",
      session,
      { items: [{ name: "Fictional toast", carbs: 5 }], photoDataUrl: png },
      deps,
    );
    expect(meal.photo?.thumbUrl).toContain("thumb.jpg");
    expect(photos.photos.size).toBe(1);
    await setMealPhoto("s1", meal.id, session, png, deps);
    expect(photos.photos.size).toBe(1);
    await setMealPhoto("s1", meal.id, session, null, deps);
    expect(photos.photos.size).toBe(0);
    await setMealPhoto("s1", meal.id, session, png, deps);
    await deleteMeal("s1", meal.id, session, deps);
    expect(rows.size).toBe(0);
    expect(photos.photos.size).toBe(0);
    expect(events.map((e) => e.type)).toEqual([
      "meal.created",
      "meal.updated",
      "meal.updated",
      "meal.updated",
      "meal.deleted",
    ]);
  });
  it("fails unavailable/invalid photos without saving or emitting and isolates spaces", async () => {
    await expect(
      createMeal(
        "s1",
        session,
        { items: [{ name: "Toast", carbs: 5 }], photoDataUrl: "data:image/png;base64,aGVsbG8=" },
        { ...deps, photos: null },
      ),
    ).rejects.toMatchObject({ code: "photo-unavailable" });
    await expect(
      createMeal(
        "s1",
        session,
        { items: [{ name: "Toast", carbs: 5 }], photoDataUrl: "data:image/png;base64,aGVsbG8=" },
        deps,
      ),
    ).rejects.toMatchObject({ code: "photo-type" });
    const meal = await createMeal("s1", session, { items: [{ name: "Toast", carbs: 5 }] }, deps);
    await expect(getMeal("s2", meal.id, "en", deps)).rejects.toMatchObject({ code: "not-found" });
    await expect(deleteMeal("s2", meal.id, session, deps)).rejects.toMatchObject({ code: "not-found" });
    expect(events).toHaveLength(1);
  });
});

describe("the meal symbol (v0.6.0 task 1)", () => {
  it("stores mealSymbol() of the snapshotted items, which carry the food's category, and shows it", async () => {
    food.category = "bread";
    const view = await createMeal(
      "s1",
      session,
      {
        items: [
          { foodId: "f1", name: "ignored", grams: 50 },
          { name: "Fictional berries", carbs: 7 },
        ],
      },
      deps,
    );
    expect(view.symbol).toBe("bread");
    expect(rows.get(view.id)?.symbol).toBe("bread");
    expect(rows.get(view.id)?.items.map((item) => item.category)).toEqual(["bread", undefined]);
    expect(JSON.stringify(view.items)).not.toContain("category");
    expect((await getMeal("s1", view.id, session.locale, deps)).symbol).toBe("bread");
    const manual = await createMeal("s1", session, { items: [{ name: "Manual", carbs: 5 }] }, deps);
    expect(manual.symbol).toBe("unknown");
    expect(rows.get(manual.id)?.symbol).toBe("unknown");
  });
  it("recomputes the symbol only when the items change, never from a later library edit", async () => {
    food.category = "bread";
    const created = await createMeal(
      "s1",
      session,
      { items: [{ foodId: "f1", name: "ignored", grams: 50 }] },
      deps,
    );
    food.category = "dairy";
    const noted = await updateMeal("s1", created.id, session, { note: "Fictional note" }, deps);
    expect(noted.symbol).toBe("bread");
    expect(rows.get(created.id)?.symbol).toBe("bread");
    const replaced = await updateMeal(
      "s1",
      created.id,
      session,
      { items: [{ foodId: "f1", name: "ignored", grams: 50 }] },
      deps,
    );
    expect(replaced.symbol).toBe("dairy");
    expect(rows.get(created.id)?.symbol).toBe("dairy");
    const typed = await updateMeal(
      "s1",
      created.id,
      session,
      { items: [{ name: "Typed", carbs: 5 }] },
      deps,
    );
    expect(typed.symbol).toBe("unknown");
    expect(events.map((e) => e.type)).toEqual([
      "meal.created",
      "meal.updated",
      "meal.updated",
      "meal.updated",
    ]);
  });
});
