import { describe, expect, it } from "vitest";
import { CreateMealRequest, UpdateMealRequest } from "./meal";

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
