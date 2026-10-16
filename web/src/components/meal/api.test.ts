import type { FoodView, LookupResponse } from "@frejsi/shared/schemas/food";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LogApiError,
  createManualFood,
  createMeal,
  deleteMeal,
  listFoods,
  lookupBarcode,
  lookupText,
  pickCandidate,
  updateMeal,
} from "./api";
import { fetchFake } from "./test-support";

const food: FoodView = {
  id: "f1",
  name: "Fictional bread",
  carbsPer100g: 40,
  portions: [],
  origin: "manual",
  verified: false,
  favourite: false,
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
};
const empty: LookupResponse = { results: [], sources: {}, manual: { name: "x" } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("log api client", () => {
  it("looks up text with the remote flag and barcodes on their own", async () => {
    const fake = fetchFake().on("GET /api/spaces/s1/lookup", empty);
    fake.install();
    await lookupText("s1", "rye bread", false);
    await lookupBarcode("s1", "2000000000015");
    expect(fake.calls.map((c) => c.path)).toEqual([
      "/api/spaces/s1/lookup?q=rye+bread&remote=false",
      "/api/spaces/s1/lookup?barcode=2000000000015",
    ]);
  });

  it("reads the foods list bare or wrapped", async () => {
    const fake = fetchFake().on("GET /api/spaces/s1/foods", { foods: [food], counts: {} });
    fake.install();
    expect(await listFoods("s1", "favourites")).toEqual([food]);
    expect(fake.calls[0]?.path).toBe("/api/spaces/s1/foods?filter=favourites");
  });

  it("creates manual foods from the log and picks candidates through POST foods", async () => {
    const fake = fetchFake().on("POST /api/spaces/s1/foods", food, 201);
    fake.install();
    await createManualFood("s1", { name: "Fictional bread", carbsPer100g: 40, portions: [] });
    await pickCandidate("s1", {
      name: "Fictional bread",
      portions: [{ label: "1 slice", carbs: 18 }],
      origin: "off",
      sourceRef: "off:2000000000015",
    });
    expect(fake.calls.map((c) => c.body)).toEqual([
      { from: "log", name: "Fictional bread", carbsPer100g: 40, portions: [] },
      {
        candidate: {
          name: "Fictional bread",
          portions: [{ label: "1 slice", carbs: 18 }],
          origin: "off",
          sourceRef: "off:2000000000015",
        },
      },
    ]);
    expect(JSON.stringify(fake.calls)).not.toContain("verified");
  });

  it("writes meals through POST, PATCH and DELETE", async () => {
    const fake = fetchFake()
      .on("POST /api/spaces/s1/meals", {}, 201)
      .on("PATCH /api/spaces/s1/meals/m1", {})
      .on("DELETE /api/spaces/s1/meals/m1", null, 204);
    fake.install();
    const request = { items: [{ name: "x", carbs: 3 }] };
    await createMeal("s1", request);
    await updateMeal("s1", "m1", request);
    await deleteMeal("s1", "m1");
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/spaces/s1/meals",
      "PATCH /api/spaces/s1/meals/m1",
      "DELETE /api/spaces/s1/meals/m1",
    ]);
  });

  it("turns an error body into its stable code and a network failure into internal", async () => {
    fetchFake()
      .on("GET /api/spaces/s1/lookup", { error: { code: "lookup-unavailable", message: "x" } }, 503)
      .install();
    await expect(lookupText("s1", "x", true)).rejects.toEqual(
      new LogApiError(503, "lookup-unavailable"),
    );
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    await expect(createMeal("s1", { items: [{ name: "x", carbs: 1 }] })).rejects.toMatchObject({
      code: "internal",
      status: 0,
    });
  });
});
