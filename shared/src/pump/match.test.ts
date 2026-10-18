import { describe, expect, it } from "vitest";

import {
  AFTER_MINUTES,
  BEFORE_MINUTES,
  diffLinks,
  matchBoluses,
  type MatchBolus,
  type MatchMeal,
} from "./match";

const base = Date.parse("2026-10-18T12:00:00.000Z");
const at = (minutes: number) => new Date(base + minutes * 60_000).toISOString();

const meal = (id: string, minutes: number, extra: Partial<MatchMeal> = {}): MatchMeal => ({
  id,
  ts: at(minutes),
  source: null,
  pumpBolusId: null,
  ...extra,
});
const bolus = (id: string, minutes: number, kind: MatchBolus["kind"] = "standard"): MatchBolus => ({
  id,
  ts: at(minutes),
  kind,
});

/** The match as `{ mealId: bolusId }`. */
const pairs = (meals: MatchMeal[], boluses: MatchBolus[]) =>
  Object.fromEntries(matchBoluses(meals, boluses).map((link) => [link.mealId, link.bolusId]));

describe("matchBoluses (v0.7.0 plan §6)", () => {
  it("has the window the owner agreed: 45 minutes before to 30 minutes after a meal", () => {
    expect(BEFORE_MINUTES).toBe(45);
    expect(AFTER_MINUTES).toBe(30);
  });

  it("pairs a meal with the nearest standard or extended bolus in the window", () => {
    expect(pairs([meal("m1", 0)], [bolus("b-before", -10), bolus("b-after", 5)])).toEqual({
      m1: "b-after",
    });
    expect(pairs([meal("m1", 0)], [bolus("b-ext", -12, "extended")])).toEqual({ m1: "b-ext" });
  });

  it("gives a tie at 10 minutes either side to the bolus before the meal", () => {
    expect(pairs([meal("m1", 0)], [bolus("b-after", 10), bolus("b-before", -10)])).toEqual({
      m1: "b-before",
    });
  });

  it("matches at the edges of the window and not one minute beyond", () => {
    expect(pairs([meal("m1", 0)], [bolus("b", -45)])).toEqual({ m1: "b" });
    expect(pairs([meal("m1", 0)], [bolus("b", 30)])).toEqual({ m1: "b" });
    expect(pairs([meal("m1", 0)], [bolus("b", -46)])).toEqual({});
    expect(pairs([meal("m1", 0)], [bolus("b", 31)])).toEqual({});
  });

  it("never matches an automatic or other bolus, even one minute before the meal", () => {
    expect(pairs([meal("m1", 0)], [bolus("b-auto", -1, "automatic")])).toEqual({});
    expect(pairs([meal("m1", 0)], [bolus("b-other", -1, "other")])).toEqual({});
    // A manual bolus further away still wins over the automatic one next to the meal.
    expect(pairs([meal("m1", 0)], [bolus("b-auto", -1, "automatic"), bolus("b", -20)])).toEqual({
      m1: "b",
    });
  });

  it("gives one bolus between two meals 20 minutes apart to the nearer meal only", () => {
    expect(pairs([meal("m1", 0), meal("m2", 20)], [bolus("b", 5)])).toEqual({ m1: "b" });
    expect(pairs([meal("m1", 0), meal("m2", 20)], [bolus("b", 15)])).toEqual({ m2: "b" });
    // Equidistant: the bolus is before m2 and after m1, so m2 gets it.
    expect(pairs([meal("m1", 0), meal("m2", 20)], [bolus("b", 10)])).toEqual({ m2: "b" });
  });

  it("gives no meal two boluses and no bolus two meals", () => {
    const links = matchBoluses(
      [meal("m1", 0), meal("m2", 15), meal("m3", 60)],
      [bolus("b1", -5), bolus("b2", 12), bolus("b3", 50), bolus("b4", 70)],
    );
    expect(new Set(links.map((link) => link.mealId)).size).toBe(links.length);
    expect(new Set(links.map((link) => link.bolusId)).size).toBe(links.length);
    expect(Object.fromEntries(links.map((link) => [link.mealId, link.bolusId]))).toEqual({
      m1: "b1",
      m2: "b2",
      m3: "b3",
    });
  });

  it("is greedy by distance, not by meal order", () => {
    // m1 at 0 and m2 at 20; b at 18 is closest to m2 (2 min); b2 at -5 is 5 min from m1.
    // A meal-ordered greedy would give m1 the bolus at 18? No: m1's nearest is -5. But with only
    // the bolus at 18, m1 (18 min) loses to m2 (2 min) whatever the meal order.
    expect(pairs([meal("m1", 0), meal("m2", 20)], [bolus("b", 18)])).toEqual({ m2: "b" });
    expect(pairs([meal("m2", 20), meal("m1", 0)], [bolus("b", 18)])).toEqual({ m2: "b" });
  });

  it("leaves an untouched pump meal with its own bolus and never gives it another", () => {
    const pumpMeal = meal("pm", 0, { source: "pump", pumpBolusId: "b-own" });
    expect(pairs([pumpMeal], [bolus("b-own", 0), bolus("b-new", 5)])).toEqual({ pm: "b-own" });
    // Its own bolus is not up for grabs by a person's meal; the other bolus is.
    expect(pairs([pumpMeal, meal("m1", 3)], [bolus("b-own", 0), bolus("b-new", 5)])).toEqual({
      pm: "b-own",
      m1: "b-new",
    });
    // A person's meal in the window of the pump meal's bolus takes it; the caller removes the
    // pump meal (diffLinks lists it), so the pump meal keeps no link in the result.
    expect(pairs([pumpMeal, meal("m1", 3)], [bolus("b-own", 0)])).toEqual({ m1: "b-own" });
  });

  it("keeps a stored link whose bolus was not passed in, for a person's meal as for a pump meal", () => {
    // The pump cycle and the meal service pass the boluses of a window; a link to a bolus outside
    // it is not theirs to judge, and the database keeps a linked bolus from being deleted.
    const linked = meal("m1", 0, { pumpBolusId: "b-old", bolusTs: at(-40) });
    expect(matchBoluses([linked], [bolus("b-new", 5)])).toEqual([
      { mealId: "m1", bolusId: "b-old", bolusTs: at(-40) },
    ]);
    expect(diffLinks([linked], matchBoluses([linked], [bolus("b-new", 5)]))).toEqual({
      set: [],
      clear: [],
      removePumpMeals: [],
    });
    // Without a stored time the meal's own time stands in, as for a pump meal.
    expect(matchBoluses([meal("m2", 0, { pumpBolusId: "b-old" })], [])).toEqual([
      { mealId: "m2", bolusId: "b-old", bolusTs: at(0) },
    ]);
    // The bolus it kept is not given to another meal, and the other bolus is still up for grabs.
    expect(pairs([linked, meal("m3", 7)], [bolus("b-new", 5)])).toEqual({ m1: "b-old", m3: "b-new" });
    const pumpMeal = meal("pm", 0, { source: "pump", pumpBolusId: "b-own", bolusTs: at(0) });
    expect(matchBoluses([pumpMeal], [])).toEqual([{ mealId: "pm", bolusId: "b-own", bolusTs: at(0) }]);
  });

  it("re-judges a stored link whose bolus was passed in: out of the window, it is cleared", () => {
    const linked = meal("m1", 0, { pumpBolusId: "b-far", bolusTs: at(-60) });
    expect(matchBoluses([linked], [bolus("b-far", -60)])).toEqual([]);
    expect(diffLinks([linked], [])).toEqual({ set: [], clear: [{ mealId: "m1" }], removePumpMeals: [] });
  });

  it("gives the same result for shuffled input (200 random days)", () => {
    let seed = 20261018;
    const random = () => {
      // A small LCG so the days are reproducible.
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const shuffle = <T>(items: T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    };
    const kinds: MatchBolus["kind"][] = ["standard", "extended", "automatic", "other"];
    for (let day = 0; day < 200; day++) {
      const meals = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, i) =>
        meal(`m${String(i)}`, Math.floor(random() * 1440), {
          source: random() < 0.15 ? "pump" : null,
          pumpBolusId: random() < 0.3 ? `b${String(Math.floor(random() * 10))}` : null,
        }),
      );
      const boluses = Array.from({ length: Math.floor(random() * 12) }, (_, i) =>
        bolus(`b${String(i)}`, Math.floor(random() * 1440), kinds[Math.floor(random() * 4)]),
      );
      const expected = matchBoluses(meals, boluses);
      for (let round = 0; round < 3; round++) {
        expect(matchBoluses(shuffle(meals), shuffle(boluses))).toEqual(expected);
      }
      // The invariants hold on every day.
      expect(new Set(expected.map((link) => link.mealId)).size).toBe(expected.length);
      expect(new Set(expected.map((link) => link.bolusId)).size).toBe(expected.length);
      for (const link of expected) {
        const known = boluses.find((b) => b.id === link.bolusId);
        const linkedMeal = meals.find((m) => m.id === link.mealId);
        if (known === undefined) {
          // A bolus the matcher was not given: the link is the stored one, kept as it was.
          expect(link.bolusId).toBe(linkedMeal?.pumpBolusId);
        } else if (linkedMeal?.source !== "pump") {
          expect(["standard", "extended"]).toContain(known.kind);
        }
      }
    }
  });
});

describe("diffLinks (v0.7.0 plan §6)", () => {
  it("returns nothing for an unchanged day", () => {
    const meals = [
      meal("m1", 0, { pumpBolusId: "b1", bolusTs: at(-5) }),
      meal("m2", 60),
      meal("pm", 120, { source: "pump", pumpBolusId: "b3", bolusTs: at(120) }),
    ];
    const matched = [
      { mealId: "m1", bolusId: "b1", bolusTs: at(-5) },
      { mealId: "pm", bolusId: "b3", bolusTs: at(120) },
    ];
    expect(diffLinks(meals, matched)).toEqual({ set: [], clear: [], removePumpMeals: [] });
  });

  it("lists exactly the links to set, the links to clear and the untouched pump meals to remove", () => {
    const meals = [
      meal("m1", 0, { pumpBolusId: "b1", bolusTs: at(-5) }), // changes to b2
      meal("m2", 60, { pumpBolusId: "b4", bolusTs: at(55) }), // loses its bolus
      meal("m3", 120), // gains b3
      meal("pm", 200, { source: "pump", pumpBolusId: "b5", bolusTs: at(200) }), // loses b5: removed
      meal("m5", 300, { pumpBolusId: "b6", bolusTs: at(295) }), // unchanged
    ];
    const matched = [
      { mealId: "m1", bolusId: "b2", bolusTs: at(-2) },
      { mealId: "m3", bolusId: "b3", bolusTs: at(118) },
      { mealId: "m4", bolusId: "b5", bolusTs: at(200) },
      { mealId: "m5", bolusId: "b6", bolusTs: at(295) },
    ];
    expect(diffLinks([...meals, meal("m4", 205)], matched)).toEqual({
      set: [
        { mealId: "m1", bolusId: "b2", bolusTs: at(-2) },
        { mealId: "m3", bolusId: "b3", bolusTs: at(118) },
        { mealId: "m4", bolusId: "b5", bolusTs: at(200) },
      ],
      clear: [{ mealId: "m2" }],
      removePumpMeals: [{ mealId: "pm" }],
    });
  });

  it("keeps a tapped bolusTs on a meal with no pump match, and lets a match replace it", () => {
    const tapped = meal("m1", 0, { bolusTs: at(-12) });
    expect(diffLinks([tapped], [])).toEqual({ set: [], clear: [], removePumpMeals: [] });
    expect(diffLinks([tapped], [{ mealId: "m1", bolusId: "b1", bolusTs: at(-8) }])).toEqual({
      set: [{ mealId: "m1", bolusId: "b1", bolusTs: at(-8) }],
      clear: [],
      removePumpMeals: [],
    });
    // A pump-set link that goes away clears both the id and the time; a tapped time without a
    // link is not the pump's to clear.
    const linked = meal("m2", 0, { pumpBolusId: "b2", bolusTs: at(-3) });
    expect(diffLinks([linked], [])).toEqual({
      set: [],
      clear: [{ mealId: "m2" }],
      removePumpMeals: [],
    });
  });

  it("re-sets a link whose bolus time moved, so bolusTs follows the record", () => {
    const linked = meal("m1", 0, { pumpBolusId: "b1", bolusTs: at(-3) });
    expect(diffLinks([linked], [{ mealId: "m1", bolusId: "b1", bolusTs: at(-4) }])).toEqual({
      set: [{ mealId: "m1", bolusId: "b1", bolusTs: at(-4) }],
      clear: [],
      removePumpMeals: [],
    });
  });
});
