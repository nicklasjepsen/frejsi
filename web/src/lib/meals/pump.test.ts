// @vitest-environment node
// Meal writes and the pump record (v0.7.0 plan §6): the real service, repository, pump links and
// writer over in-memory SQL delegates. Every meal change the match causes besides the person's
// own meal goes out in `pump.meals` on the glucose group, never as `meal.updated`.
import { describe, expect, it } from "vitest";
import { SessionContext } from "@frejsi/shared";
import { createMeal, deleteMeal, getMeal, updateMeal } from "./service";
import { bolus, mealRow, writerHarness } from "./test-support";

const session = SessionContext.parse({
  userId: "u1",
  name: "Fictional carer",
  simpleMode: false,
  accent: "olive",
  theme: "system",
  locale: "en",
  memberships: [{ spaceId: "s1", role: "carer" }],
});
const t = (hhmm: string) => new Date(`2026-10-15T${hhmm}:00.000Z`);
const iso = (hhmm: string) => t(hhmm).toISOString();
const items = [{ name: "Fictional rye bread", carbs: 40 }];

function setup() {
  const h = writerHarness();
  const deps = { repo: h.repo, photos: null, write: h.write, now: () => t("13:00") };
  return { ...h, deps };
}
/** A carb bolus at 11:50 and the untouched pump meal the cycle made from it. */
function withPumpMeal(h: ReturnType<typeof setup>) {
  h.boluses.set("b1", bolus({ id: "b1", ts: t("11:50"), units: 2.4, carbs: 45 }));
  h.rows.set(
    "pm1",
    mealRow({
      id: "pm1",
      ts: t("11:50"),
      totalCarbs: 45,
      source: "pump",
      pumpBolusId: "b1",
      bolusTs: t("11:50"),
    }),
  );
}
const published = (h: ReturnType<typeof setup>) =>
  h.sink.published.map(({ group, envelope }) => [group, envelope.type]);

describe("meal writes re-match the pump record", () => {
  it("links a meal logged 10 minutes after a carb bolus and removes the untouched pump meal", async () => {
    const h = setup();
    withPumpMeal(h);
    const view = await createMeal("s1", session, { ts: iso("12:00"), items }, h.deps);
    expect(view).toMatchObject({
      bolusTs: iso("11:50"),
      bolusUnits: 2.4,
      pumpCarbs: 45,
      pumpBolusId: "b1",
    });
    expect(view).not.toHaveProperty("fromPump");
    expect(typeof view.bolusUnits).toBe("number");
    expect(h.rows.has("pm1")).toBe(false);
    expect(h.events).toEqual([
      { type: "meal.created", payload: { mealId: view.id, ts: iso("12:00"), totalCarbs: 40 } },
      { type: "pump.meals", payload: { updated: [], created: [], removed: ["pm1"] } },
    ]);
    expect(published(h)).toEqual([
      ["space-s1", "meal.created"],
      ["space-s1-glucose", "pump.meals"],
    ]);
    expect(h.isolation).toEqual([{ isolationLevel: "Serializable" }]);
  });

  it("unlinks a meal moved out of the window, and lists only the other meals the match changed", async () => {
    const h = setup();
    h.boluses.set("b1", bolus({ id: "b1", ts: t("11:50"), carbs: 45 }));
    // A snack at 12:20 holds the 11:50 bolus (30 minutes before it).
    h.rows.set(
      "snack",
      mealRow({ id: "snack", ts: t("12:20"), pumpBolusId: "b1", bolusTs: t("11:50") }),
    );
    const lunch = await createMeal("s1", session, { ts: iso("11:55"), items }, h.deps);
    expect(lunch.pumpBolusId).toBe("b1");
    expect(h.rows.get("snack")).toMatchObject({ pumpBolusId: null, bolusTs: null });
    expect(h.events.map((e) => e.type)).toEqual(["meal.created", "pump.meals"]);
    expect(h.events[1]?.payload).toEqual({ updated: ["snack"], created: [], removed: [] });

    h.events.length = 0;
    const moved = await updateMeal("s1", lunch.id, session, { ts: iso("15:00") }, h.deps);
    expect(moved).not.toHaveProperty("pumpBolusId");
    expect(moved).not.toHaveProperty("bolusTs");
    expect(moved).not.toHaveProperty("bolusUnits");
    // The bolus is free again; the snack at 12:20 is the nearest meal and takes it back.
    expect(h.rows.get("snack")).toMatchObject({ pumpBolusId: "b1", bolusTs: t("11:50") });
    expect(h.events).toEqual([
      { type: "meal.updated", payload: { mealId: lunch.id } },
      { type: "pump.meals", payload: { updated: ["snack"], created: [], removed: [] } },
    ]);
  });

  it("gives a deleted meal's bolus to the next meal in its window", async () => {
    const h = setup();
    h.boluses.set("b1", bolus({ id: "b1", ts: t("11:50") }));
    h.rows.set("snack", mealRow({ id: "snack", ts: t("12:20") }));
    const lunch = await createMeal("s1", session, { ts: iso("11:55"), items }, h.deps);
    expect(lunch.pumpBolusId).toBe("b1");
    expect(h.rows.get("snack")?.pumpBolusId).toBeNull();
    expect(h.events.map((e) => e.type)).toEqual(["meal.created"]);
    h.events.length = 0;
    await deleteMeal("s1", lunch.id, session, h.deps);
    expect(h.rows.get("snack")).toMatchObject({ pumpBolusId: "b1", bolusTs: t("11:50") });
    expect(h.events).toEqual([
      { type: "meal.deleted", payload: { mealId: lunch.id } },
      { type: "pump.meals", payload: { updated: ["snack"], created: [], removed: [] } },
    ]);
  });

  it("re-matches only on a time change, and keeps a tapped bolus time the pump does not match", async () => {
    const h = setup();
    h.boluses.set("auto", bolus({ id: "auto", ts: t("11:59"), kind: "automatic" }));
    const tapped = await createMeal(
      "s1",
      session,
      { ts: iso("12:00"), bolusTs: iso("11:48"), items },
      h.deps,
    );
    // An automatic bolus never attaches (plan decision 8); the old tap stays.
    expect(tapped.bolusTs).toBe(iso("11:48"));
    expect(tapped).not.toHaveProperty("pumpBolusId");
    h.boluses.set("b1", bolus({ id: "b1", ts: t("11:58") }));
    const noted = await updateMeal("s1", tapped.id, session, { note: "Fictional" }, h.deps);
    expect(noted.bolusTs).toBe(iso("11:48"));
    expect(noted).not.toHaveProperty("pumpBolusId");
    const moved = await updateMeal("s1", tapped.id, session, { ts: iso("12:01") }, h.deps);
    // A pump match replaces the tap.
    expect(moved).toMatchObject({ bolusTs: iso("11:58"), pumpBolusId: "b1", bolusUnits: 2.4 });
    expect(moved).not.toHaveProperty("pumpCarbs");
    expect(h.events.map((e) => e.type)).toEqual(["meal.created", "meal.updated", "meal.updated"]);
  });

  it("keeps the pump's bolus time on a linked meal: a different or cleared time is refused", async () => {
    const h = setup();
    h.boluses.set("b1", bolus({ id: "b1", ts: t("11:58") }));
    const lunch = await createMeal("s1", session, { ts: iso("12:00"), items }, h.deps);
    expect(lunch.bolusTs).toBe(iso("11:58"));
    h.events.length = 0;
    for (const bolusTs of [iso("11:30"), null])
      await expect(updateMeal("s1", lunch.id, session, { bolusTs }, h.deps)).rejects.toMatchObject({
        status: 400,
        code: "validation",
      });
    expect(h.rows.get(lunch.id)).toMatchObject({ pumpBolusId: "b1", bolusTs: t("11:58") });
    expect(h.events).toEqual([]);
    // Sending the pump's own time back with an edit changes nothing about it.
    const noted = await updateMeal(
      "s1",
      lunch.id,
      session,
      { bolusTs: iso("11:58"), note: "Fictional" },
      h.deps,
    );
    expect(noted).toMatchObject({ bolusTs: iso("11:58"), pumpBolusId: "b1", note: "Fictional" });
  });

  it("never takes a bolus that belongs to a meal outside the window", async () => {
    const h = setup();
    // A meal at 12:00 re-matches the meals from 10:45 to 13:15. The one at 10:50 is inside and
    // could take the 10:40 bolus, but that bolus belongs to the 10:30 meal, which is outside.
    h.boluses.set("b1", bolus({ id: "b1", ts: t("10:40") }));
    h.rows.set(
      "outside",
      mealRow({ id: "outside", ts: t("10:30"), pumpBolusId: "b1", bolusTs: t("10:40") }),
    );
    h.rows.set("edge", mealRow({ id: "edge", ts: t("10:50") }));
    const view = await createMeal("s1", session, { ts: iso("12:00"), items }, h.deps);
    expect(view).not.toHaveProperty("pumpBolusId");
    expect(h.rows.get("outside")?.pumpBolusId).toBe("b1");
    expect(h.rows.get("edge")?.pumpBolusId).toBeNull();
    expect(h.events.map((e) => e.type)).toEqual(["meal.created"]);
  });

  it("dismisses the bolus of a pump meal a person deletes, so the cycle never makes it again", async () => {
    const h = setup();
    withPumpMeal(h);
    await deleteMeal("s1", "pm1", session, h.deps);
    expect(h.rows.has("pm1")).toBe(false);
    expect(h.boluses.get("b1")?.mealDismissed).toBe(true);
    expect(h.events).toEqual([{ type: "meal.deleted", payload: { mealId: "pm1" } }]);
  });

  it("dismisses a bolus a person's own meal lets go of when no meal takes it, so the cycle makes no second meal", async () => {
    // An untouched pump meal at 11:50 moved to 12:50 leaves its bolus's window and keeps the
    // carbs; were the bolus left free, the pump cycle would make a second 45 g meal at 11:50.
    const h = setup();
    withPumpMeal(h);
    const moved = await updateMeal("s1", "pm1", session, { ts: iso("12:50") }, h.deps);
    expect(moved).not.toHaveProperty("pumpBolusId");
    expect(h.rows.get("pm1")).toMatchObject({ source: null, pumpBolusId: null, totalCarbs: 45 });
    expect(h.boluses.get("b1")?.mealDismissed).toBe(true);
    expect(h.events).toEqual([{ type: "meal.updated", payload: { mealId: "pm1" } }]);

    // Deleting an ordinary meal that held a carb bolus: the person removed those carbs.
    h.boluses.set("b2", bolus({ id: "b2", ts: t("18:00"), carbs: 30 }));
    const dinner = await createMeal("s1", session, { ts: iso("18:05"), items }, h.deps);
    expect(dinner.pumpBolusId).toBe("b2");
    await deleteMeal("s1", dinner.id, session, h.deps);
    expect(h.boluses.get("b2")?.mealDismissed).toBe(true);
  });

  it("dismisses nothing when another meal takes the bolus, or the moved meal takes another one", async () => {
    const h = setup();
    h.boluses.set("b1", bolus({ id: "b1", ts: t("11:50"), carbs: 45 }));
    h.boluses.set("b2", bolus({ id: "b2", ts: t("15:00"), carbs: 30 }));
    h.rows.set("snack", mealRow({ id: "snack", ts: t("12:20") }));
    const lunch = await createMeal("s1", session, { ts: iso("11:55"), items }, h.deps);
    expect(lunch.pumpBolusId).toBe("b1");
    // Moved onto the 15:00 bolus: the meal now accounts for b2, and the snack takes b1.
    const moved = await updateMeal("s1", lunch.id, session, { ts: iso("15:05") }, h.deps);
    expect(moved.pumpBolusId).toBe("b2");
    expect(h.rows.get("snack")?.pumpBolusId).toBe("b1");
    expect(h.boluses.get("b1")?.mealDismissed).toBe(false);
    expect(h.boluses.get("b2")?.mealDismissed).toBe(false);

    // With no snack, the 11:50 bolus stays free once the meal swaps it for b2: its carbs are not
    // the meal's, so the pump cycle may still make a meal from them.
    const alone = setup();
    alone.boluses.set("b1", bolus({ id: "b1", ts: t("11:50"), carbs: 45 }));
    alone.boluses.set("b2", bolus({ id: "b2", ts: t("15:00"), carbs: 30 }));
    const meal = await createMeal("s1", session, { ts: iso("11:55"), items }, alone.deps);
    expect(meal.pumpBolusId).toBe("b1");
    expect(
      (await updateMeal("s1", meal.id, session, { ts: iso("15:05") }, alone.deps)).pumpBolusId,
    ).toBe("b2");
    expect(alone.boluses.get("b1")).toMatchObject({ mealDismissed: false });
  });

  it("retries once on a serialization failure without the first attempt's events", async () => {
    const h = setup();
    withPumpMeal(h);
    h.conflictNext();
    const view = await createMeal("s1", session, { ts: iso("12:00"), items }, h.deps);
    expect(view.pumpBolusId).toBe("b1");
    expect(h.isolation).toEqual([
      { isolationLevel: "Serializable" },
      { isolationLevel: "Serializable" },
    ]);
    expect(h.events.map((e) => e.type)).toEqual(["meal.created", "pump.meals"]);
    expect(published(h)).toHaveLength(2);
    h.conflictNext(2);
    await expect(
      createMeal("s1", session, { ts: iso("16:00"), items }, h.deps),
    ).rejects.toMatchObject({ code: "P2034" });
    expect(h.events).toHaveLength(2);
  });
});

describe("the pump fields on MealView (plan §4)", () => {
  it("carries pumpBolusId only for a linked meal, and fromPump only while source is pump", async () => {
    const h = setup();
    withPumpMeal(h);
    h.rows.set("plain", mealRow({ id: "plain", ts: t("08:00") }));
    const pumpMeal = await getMeal("s1", "pm1", session, h.deps);
    expect(pumpMeal).toMatchObject({ fromPump: true, pumpBolusId: "b1", bolusUnits: 2.4 });
    expect(pumpMeal.pumpCarbs).toBe(45);
    const plain = await getMeal("s1", "plain", session, h.deps);
    for (const key of ["pumpBolusId", "fromPump", "bolusUnits", "pumpCarbs", "bolusTs"])
      expect(plain).not.toHaveProperty(key);
  });
});
