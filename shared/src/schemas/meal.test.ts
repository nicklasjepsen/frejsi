import { describe, expect, it } from "vitest";
import { DayHistoryMeal, WeekDayTile } from "./history";
import { CreateMealRequest, DayMealView, DayView, MealView, UpdateMealRequest } from "./meal";

describe("meal timestamp updates", () => {
  it("distinguishes clearing from omission and accepts only timestamps otherwise", () => {
    expect(UpdateMealRequest.parse({ bolusTs: null })).toEqual({ bolusTs: null });
    expect(UpdateMealRequest.parse({})).not.toHaveProperty("bolusTs");
    expect(UpdateMealRequest.safeParse({ bolusTs: "2026-10-15T10:00:00.000Z" }).success).toBe(true);
    expect(UpdateMealRequest.safeParse({ bolusTs: "tomorrow" }).success).toBe(false);
    expect(
      CreateMealRequest.safeParse({
        items: [{ name: "Fictional toast", carbs: 12 }],
        bolusTs: null,
      }).success,
    ).toBe(false);
  });
});

describe("the meal symbol on the views (v0.6.0 plan §4)", () => {
  const dayMeal = {
    id: "m1",
    ts: "2026-10-15T10:00:00.000Z",
    title: "Fictional toast",
    slot: "lunch",
    totalCarbs: 18,
    byUser: { id: "u1", name: "Example Person" },
    items: [{ name: "Fictional toast", carbs: 18 }],
  };
  it("carries a MealSymbol on MealView and DayMealView, and rejects anything else", () => {
    expect(MealView.parse({ ...dayMeal, symbol: "bread" }).symbol).toBe("bread");
    expect(DayMealView.parse({ ...dayMeal, symbol: "unknown" }).symbol).toBe("unknown");
    expect(MealView.safeParse({ ...dayMeal, symbol: "loaf" }).success).toBe(false);
    expect(DayMealView.safeParse({ ...dayMeal, symbol: null }).success).toBe(false);
    // A view without the key still parses: fixtures and clients from before 0005.
    expect(MealView.parse(dayMeal).symbol).toBeUndefined();
    expect(
      DayView.parse({
        date: "2026-10-15",
        timezone: "Europe/Copenhagen",
        totalCarbs: 18,
        mealCount: 1,
        meals: [{ ...dayMeal, symbol: "fruit" }],
      }).meals[0]?.symbol,
    ).toBe("fruit");
  });
  it("puts {ts, symbol} on the week tile next to mealTimes, and on the history meal", () => {
    const tile = {
      date: "2026-10-14",
      mealCount: 1,
      totalCarbs: 40,
      curve: [],
      mealTimes: [dayMeal.ts],
    };
    expect(WeekDayTile.parse({ ...tile, meals: [{ ts: dayMeal.ts, symbol: "starch" }] })).toEqual({
      ...tile,
      meals: [{ ts: dayMeal.ts, symbol: "starch" }],
    });
    expect(WeekDayTile.parse(tile).meals).toEqual([]);
    expect(WeekDayTile.safeParse({ ...tile, meals: [{ ts: dayMeal.ts }] }).success).toBe(false);
    expect(
      WeekDayTile.safeParse({ ...tile, meals: [{ ts: dayMeal.ts, symbol: "bread", mmol: 6 }] })
        .success,
    ).toBe(false);
    const stats = {
      inRange: {
        minutes: 0,
        coveredMinutes: 0,
        windowMinutes: 180,
        complete: false,
        belowMinutes: 0,
        aboveMinutes: 0,
      },
      readingCount: 0,
    };
    expect(DayHistoryMeal.parse({ ...dayMeal, symbol: "mixed", stats }).symbol).toBe("mixed");
  });
});
