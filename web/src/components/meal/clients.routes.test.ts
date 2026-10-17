// @vitest-environment node
// Every call the screens make, made by their own clients against the real route handlers (issue
// #40's reconciliation): the library lane's `libraryApi`, the log lane's `components/meal/api`,
// and the day reads Nu and the picker make. Nothing here fakes a response.
import { FoodView, LookupResponse } from "@frejsi/shared/schemas/food";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fetchDay } from "@/components/day/api";
import { LibraryApiError, libraryApi } from "@/components/library/api-client";
import { eatNow, loadPickerFoods } from "@/components/simple/api";

import {
  createManualFood,
  createMeal,
  deleteMeal,
  getMeal,
  listFoods,
  LogApiError,
  lookupBarcode,
  lookupText,
  pickCandidate,
  updateMeal,
} from "./api";
import { addFood, choosePortion, draftFromMeal, emptyDraft, toMealRequest } from "./draft";
import { JPEG, realRoutes } from "./routes-harness.test";

let routes: ReturnType<typeof realRoutes>;
beforeEach(() => {
  routes = realRoutes();
});
afterEach(() => {
  routes.reset();
});

const rye = { label: "1 skive", grams: 45, carbs: 20 };

describe("libraryApi against the foods routes", () => {
  it("lists with the counts per filter, by filter, by origin and by search", async () => {
    routes.food({ id: "a", name: "Rugbrod", verified: true, portions: [rye] });
    routes.food({ id: "b", name: "Havregrod", origin: "off" });
    let list = await libraryApi.list("s1", { filter: "all", q: "" });
    expect(list.foods.map((f) => f.id).sort()).toEqual(["a", "b"]);
    expect(list.counts).toMatchObject({ all: 2, unverified: 1, own: 1, off: 1 });
    list = await libraryApi.list("s1", { filter: "unverified", q: "" });
    expect(list.foods.map((f) => f.id)).toEqual(["b"]);
    list = await libraryApi.list("s1", { filter: "off", q: "" });
    expect(list.foods.map((f) => f.id)).toEqual(["b"]);
    list = await libraryApi.list("s1", { filter: "all", q: "  rugbr " });
    expect(list.foods.map((f) => f.id)).toEqual(["a"]);
  });

  it("never sends a search the route refuses: a long query is cut to the route's 80 characters", async () => {
    routes.food({ id: "a", name: "Rugbrod" });
    const list = await libraryApi.list("s1", { filter: "all", q: `rugbrod ${"x".repeat(120)}` });
    expect(list.foods).toEqual([]);
  });

  it("creates as family, verifies on 'Gem og godkend', reads, patches, verifies and removes", async () => {
    const created = await libraryApi.create(
      "s1",
      { name: "Min madpakke", portions: [{ label: "1 madpakke", carbs: 42 }] },
      { verify: false },
    );
    expect(created).toMatchObject({ origin: "family", verified: false });
    const approved = await libraryApi.create(
      "s1",
      { name: "Pasta", carbsPer100g: 25, portions: [] },
      { verify: true },
    );
    expect(approved).toMatchObject({ origin: "family", verified: true });
    expect(await libraryApi.get("s1", created.id)).toEqual(created);
    const patched = await libraryApi.update("s1", created.id, { favourite: true });
    expect(patched.favourite).toBe(true);
    await libraryApi.verify("s1", [created.id]);
    expect((await libraryApi.get("s1", created.id)).verified).toBe(true);
    await libraryApi.remove("s1", created.id);
    await expect(libraryApi.get("s1", created.id)).rejects.toMatchObject({
      status: 404,
      code: "not-found",
    });
    expect(routes.events).toEqual([]);
    expect(routes.rig.events.map((e) => e.type)).toEqual([
      "food.created",
      "food.created",
      "food.verified",
      "food.updated",
      "food.verified",
      "food.deleted",
    ]);
  });

  it("uploads the JPEG the form prepared and reads the photo back on the food", async () => {
    routes.food({ id: "a", name: "Rugbrod", portions: [rye] });
    const food = await libraryApi.putPhoto("s1", "a", JPEG);
    expect(food?.photo?.thumbUrl).toContain("/foods/a/");
  });

  it("carries the route's error code: a viewer is refused, and a child cannot verify", async () => {
    routes.food({ id: "a", name: "Rugbrod", portions: [rye] });
    routes.as("viewer");
    await expect(libraryApi.list("s1", { filter: "all", q: "" })).rejects.toBeInstanceOf(
      LibraryApiError,
    );
    await expect(libraryApi.list("s1", { filter: "all", q: "" })).rejects.toMatchObject({
      status: 403,
    });
    routes.as("child");
    await expect(libraryApi.verify("s1", ["a"])).rejects.toMatchObject({
      status: 400,
      code: "simple-mode",
    });
  });
});

describe("the log screen's client against the lookup, foods and meals routes", () => {
  it("looks up text as the user types (remote=false) and on submit, and a barcode", async () => {
    routes.food({ id: "a", name: "Rugbrod", verified: true, portions: [rye] });
    const typed = await lookupText("s1", "rugbrod", false);
    expect(LookupResponse.parse(typed).results[0]).toMatchObject({ source: "library" });
    expect(typed.sources["remote-test"]).toBe("skipped");
    const submitted = await lookupText("s1", "cloud", true);
    expect(submitted.results.some((r) => r.source === "remote-test")).toBe(true);
    const scanned = await lookupBarcode("s1", "2000000000015");
    expect(scanned.results[0]?.food).toMatchObject({ barcode: "2000000000015" });
  });

  it("never sends a search the lookup route refuses: a long query is cut to 80 characters", async () => {
    const response = await lookupText("s1", "y".repeat(200), false);
    expect(response.results).toEqual([]);
  });

  it("reads the library lists the log screen shows", async () => {
    routes.food({ id: "a", name: "Rugbrod", verified: true, favourite: true, portions: [rye] });
    routes.food({ id: "b", name: "Havregrod" });
    expect((await listFoods("s1", "all")).map((f) => f.id).sort()).toEqual(["a", "b"]);
    expect((await listFoods("s1", "favourites")).map((f) => f.id)).toEqual(["a"]);
    expect(await listFoods("s1", "recent")).toEqual([]);
  });

  it("picks a remote candidate into the library and creates 'Jeg kender tallet selv' as manual", async () => {
    const scanned = await lookupBarcode("s1", "2000000000015");
    const candidate = scanned.results.find((r) => r.source === "remote-test")?.food;
    if (!candidate || "id" in candidate) throw new Error("no candidate");
    const picked = await pickCandidate("s1", candidate);
    expect(FoodView.parse(picked)).toMatchObject({ origin: "remote-test", verified: false });
    expect((await pickCandidate("s1", candidate)).id).toBe(picked.id);
    const manual = await createManualFood("s1", {
      name: "Bedstes boller",
      portions: [{ label: "1 bolle", carbs: 30 }],
    });
    expect(manual).toMatchObject({ origin: "manual", verified: false });
  });

  it("saves a meal, reads it back, corrects it and deletes it, one event per write", async () => {
    routes.food({ id: "a", name: "Rugbrod", verified: true, portions: [rye] });
    await createMeal("s1", {
      items: [
        { foodId: "a", name: "Rugbrod", portionLabel: "1 skive", carbs: 20 },
        { name: "Aeble", carbs: 14 },
      ],
      bolusTs: T0iso(),
    });
    const [id] = [...routes.meals.keys()];
    if (!id) throw new Error("no meal");
    const meal = await getMeal("s1", id);
    expect(meal).toMatchObject({ totalCarbs: 34, bolusTs: T0iso(), byUser: { name: "Jonas" } });
    await updateMeal("s1", id, { items: [{ name: "Rugbrod", carbs: 40 }] });
    expect((await getMeal("s1", id)).totalCarbs).toBe(40);
    await deleteMeal("s1", id);
    await expect(getMeal("s1", id)).rejects.toMatchObject({ status: 404, code: "not-found" });
    expect(routes.events).toEqual(["meal.created", "meal.updated", "meal.deleted"]);
  });

  it("carries the route's code when a child sends a bolus time", async () => {
    routes.as("child");
    const sent = createMeal("s1", { items: [{ name: "Aeble", carbs: 14 }], bolusTs: T0iso() });
    await expect(sent).rejects.toBeInstanceOf(LogApiError);
    await expect(
      createMeal("s1", { items: [{ name: "Aeble", carbs: 14 }], bolusTs: T0iso() }),
    ).rejects.toMatchObject({ status: 400, code: "simple-mode" });
  });
});

describe("the log draft against the meals route", () => {
  it("saves what the draft builds from a picked food, and saves a reopened meal back unchanged", async () => {
    routes.food({
      id: "a",
      name: "Rugbrod",
      verified: true,
      portions: [rye, { ...rye, label: "2 skiver", grams: 90, carbs: 40 }],
    });
    const [food] = await listFoods("s1", "all");
    if (!food) throw new Error("no food");
    const draft = choosePortion(addFood(emptyDraft(), food), "i1", 1);
    await createMeal("s1", toMealRequest(draft, null));
    const [id] = [...routes.meals.keys()];
    if (!id) throw new Error("no meal");
    const saved = await getMeal("s1", id);
    expect(saved).toMatchObject({
      totalCarbs: 40,
      items: [{ portionLabel: "2 skiver", grams: 90 }],
    });
    await updateMeal("s1", id, toMealRequest(draftFromMeal(saved), null));
    expect(await getMeal("s1", id)).toEqual(saved);
  });
});

describe("Nu's day read against the day route", () => {
  it("reads today's meals newest first, for a viewer too, with no glucose, note or bolus time", async () => {
    await createMeal("s1", {
      items: [{ name: "Aeble", carbs: 14 }],
      note: "privat",
      bolusTs: T0iso(),
    });
    routes.as("viewer");
    const day = await fetchDay("s1");
    expect(day).toMatchObject({ date: "2026-10-15", totalCarbs: 14, mealCount: 1 });
    expect(day.meals[0]).toMatchObject({ title: "Aeble", byUser: { name: "Jonas" } });
    expect(JSON.stringify(day)).not.toMatch(/privat|bolus|mmol|reading/);
    await expect(fetchDay("s1", { date: "15-10-2026" })).rejects.toMatchObject({
      status: 400,
      code: "validation",
    });
  });
});

describe("the picker (eat) against the foods and meals routes", () => {
  function seedPantry() {
    routes.food({
      id: "pack",
      name: "Min madpakke",
      verified: true,
      portions: [{ label: "1 madpakke", carbs: 42 }],
    });
    routes.food({
      id: "oats",
      name: "Havregrod",
      verified: true,
      portions: [{ label: "1 skal", grams: 250, carbs: 30 }],
    });
    routes.food({
      id: "cake",
      name: "Kage",
      favourite: true,
      portions: [{ label: "1 stykke", carbs: 35 }],
    });
    routes.food({ id: "loose", name: "Mel", verified: true, carbsPer100g: 70, portions: [] });
  }

  it("for a simpleMode session the route itself leaves out unverified foods, even a favourite eaten before", async () => {
    seedPantry();
    await createMeal("s1", {
      items: [{ foodId: "cake", name: "Kage", portionLabel: "1 stykke", carbs: 35 }],
    });
    routes.as("child");
    const listed = await listFoods("s1", "all");
    expect(listed.map((f) => f.id).sort()).toEqual(["loose", "oats", "pack"]);
    expect(await listFoods("s1", "recent")).toEqual([]);
    expect(await listFoods("s1", "favourites")).toEqual([]);
    expect((await loadPickerFoods("s1")).map((f) => f.id)).not.toContain("cake");
  });

  it("offers verified foods with a portion, recently eaten first, for any session", async () => {
    seedPantry();
    await createMeal("s1", {
      items: [{ foodId: "oats", name: "Havregrod", portionLabel: "1 skal", carbs: 30 }],
    });
    expect((await loadPickerFoods("s1")).map((f) => f.id)).toEqual(["oats", "pack"]);
    routes.as("child");
    expect((await loadPickerFoods("s1")).map((f) => f.id)).toEqual(["oats", "pack"]);
  });

  it("'Ja, det spiser jeg' saves one portion, eating in 15 minutes, without a bolus time, as the child", async () => {
    seedPantry();
    routes.as("child");
    const food = (await loadPickerFoods("s1")).find((f) => f.id === "pack");
    if (!food) throw new Error("no food");
    const saved = new Date();
    await eatNow("s1", food, 0, 15, saved);
    expect(routes.events).toEqual(["meal.created"]);
    const [meal] = [...routes.meals.values()];
    expect(meal).toMatchObject({ totalCarbs: 42, byUserId: "child", items: [{ foodId: "pack" }] });
    // The route keeps the chip's time as sent (issue #191): nothing changes in the API.
    expect(meal?.ts).toBe(new Date(saved.getTime() + 15 * 60_000).toISOString());
    expect(meal?.bolusTs).toBeUndefined();
    const day = await fetchDay("s1");
    expect(day.meals[0]).toMatchObject({
      title: "Min madpakke",
      totalCarbs: 42,
      byUser: { name: "Alma" },
    });
  });
});

function T0iso() {
  return new Date().toISOString();
}
