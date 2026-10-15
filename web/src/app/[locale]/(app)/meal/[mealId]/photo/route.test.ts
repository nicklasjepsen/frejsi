// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { JPEG, realRoutes, T0 } from "@/components/meal/routes-harness.test";
import { GET } from "./route";

let routes: ReturnType<typeof realRoutes>;
let read: Mock<typeof fetch>;
const request = (member = "carer", space = "s1", mealId = "m1") =>
  GET(
    new Request(`https://frejsi.example/da/meal/${mealId}/photo?space=${space}`, {
      headers: { cookie: `frejsi_session=sess-${member}` },
    }),
    { params: Promise.resolve({ locale: "da", mealId }) },
  );
beforeEach(() => {
  routes = realRoutes();
  routes.meals.set("m1", {
    id: "m1",
    spaceId: "s1",
    byUserId: "carer",
    byUser: { id: "carer", name: "Jonas" },
    ts: T0.toISOString(),
    timezone: "Europe/Copenhagen",
    totalCarbs: 20,
    items: [{ name: "Fictional toast", carbs: 20 }],
    photoKey: "spaces/s1/meals/m1/fictional-photo",
  });
  read = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JPEG)));
  vi.stubGlobal("fetch", read);
});
afterEach(() => {
  routes.reset();
});

describe("same-origin meal photo for save-as-dish", () => {
  it("reads the authorized meal's original bytes, no public cache or redirects", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
    expect(read.mock.calls[0]?.[0]).toBe(
      "https://photos.example.invalid/spaces/s1/meals/m1/fictional-photo/original.jpg",
    );
    expect(routes.events).toEqual([]);
  });
  it("refuses a viewer and a non-member before reading photo bytes", async () => {
    expect((await request("viewer")).status).toBe(403);
    expect((await request("carer", "s2")).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });
  it("refuses missing meals and meals without a photo", async () => {
    expect((await request("carer", "s1", "absent")).status).toBe(404);
    const meal = routes.meals.get("m1");
    if (!meal) throw new Error("fixture");
    delete meal.photoKey;
    expect((await request()).status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });
  it("returns a safe error when photo storage fails", async () => {
    read.mockResolvedValue(new Response(null, { status: 503 }));
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("photos.example.invalid");
  });
});
