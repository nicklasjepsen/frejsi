import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchFake, type FetchFake } from "@/components/meal/test-support";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";

vi.mock("@/lib/photos/downscale", () => ({
  downscale: () =>
    Promise.resolve({ arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer) }),
}));

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
const subscribe = () => () => undefined;
vi.mock("@/lib/live/useLiveFeed", () => ({
  useLiveFeed: () => ({ loaded: true, readings: [], subscribe }),
}));
import { MealDetail } from "./MealDetail";
import { curveView, MEAL_TS, mealView, previousMeal, shift } from "./test-support";

let fake: FetchFake;
let view: ReturnType<typeof curveView>;
const writes = () => fake.calls.filter((c) => c.method !== "GET");
function mount(layout: "phone" | "desktop" = "phone") {
  return render(
    <I18nProvider locale="da" messages={getMessages("da")}>
      <MealDetail
        spaceId="s1"
        mealId="m1"
        locale="da"
        timeZone="Europe/Copenhagen"
        unit="mmol"
        layout={layout}
      />
    </I18nProvider>,
  );
}
async function edit(layout: "phone" | "desktop" = "phone") {
  mount(layout);
  fireEvent.click(
    await screen.findByRole("button", { name: layout === "phone" ? "Ret" : "Ret E" }),
  );
  return within(screen.getByRole("dialog", { name: "Ret måltid" }));
}
beforeEach(() => {
  vi.useFakeTimers({ now: new Date(shift(MEAL_TS, 360)), toFake: ["Date"] });
  nav.push.mockClear();
  nav.refresh.mockClear();
  view = curveView({ previous: [previousMeal(2), previousMeal(5)] });
  view.editItems = [
    {
      name: "Rye bread",
      foodId: "bread",
      portionLabel: "2 slices",
      carbs: 36,
      carbsPer100g: 40,
      portions: [
        { label: "1 slice", grams: 45, carbs: 18 },
        { label: "2 slices", grams: 90, carbs: 36 },
      ],
    },
    { name: "Cheese", portionLabel: "1 slice", carbs: 0 },
    {
      name: "Apple",
      foodId: "apple",
      portionLabel: "1 medium",
      carbs: 14,
      portions: [
        { label: "1 medium", carbs: 14 },
        { label: "½ medium", carbs: 7 },
      ],
    },
  ];
  fake = fetchFake()
    .on("GET /api/spaces/s1/meals/m1/curve", () => view)
    .on("PATCH /api/spaces/s1/meals/m1", {})
    .on("DELETE /api/spaces/s1/meals/m1", null, 204);
  fake.install();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("edit and delete inside meal detail", () => {
  it.each(["phone", "desktop"] as const)(
    "%s: edits current portions, typed carbs, time and note and refreshes detail without navigation",
    async (layout) => {
      const sheet = await edit(layout);
      expect(sheet.getByRole("button", { name: "Tilbage" })).toBeVisible();
      expect(sheet.getByText("Bolus 11:48")).toBeVisible();
      fireEvent.click(sheet.getByRole("button", { name: "½ medium · 7 g" }));
      fireEvent.change(sheet.getByLabelText("Kulhydrat · Cheese"), { target: { value: "2" } });
      fireEvent.change(sheet.getByLabelText("Tidspunkt"), { target: { value: "11:45" } });
      fireEvent.change(sheet.getByLabelText("Note"), { target: { value: "At the park" } });
      expect(sheet.getByTestId("total-bar")).toHaveTextContent("45 g");
      view = { ...view, meal: mealView({ title: "Updated fictional meal", totalCarbs: 45 }) };
      fireEvent.click(sheet.getByRole("button", { name: "Gem" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Updated fictional meal");
      expect(nav.push).not.toHaveBeenCalled();
      expect(nav.refresh).not.toHaveBeenCalled();
      expect(writes()).toEqual([
        {
          method: "PATCH",
          path: "/api/spaces/s1/meals/m1",
          body: {
            ts: shift(MEAL_TS, -15),
            bolusTs: view.meal.bolusTs,
            note: "At the park",
            items: [
              { name: "Rye bread", foodId: "bread", portionLabel: "2 slices", carbs: 36 },
              { name: "Cheese", portionLabel: "1 slice", carbs: 2 },
              { name: "Apple", foodId: "apple", portionLabel: "½ medium", carbs: 7 },
            ],
          },
        },
      ]);
      expect(fake.calls.filter((c) => c.method === "GET").map((c) => c.path)).toEqual([
        "/api/spaces/s1/meals/m1/curve",
        "/api/spaces/s1/meals/m1/curve",
      ]);
    },
  );
  it("preserves stored nutrition on a note-only edit by omitting unchanged items", async () => {
    const bread = view.editItems[0];
    if (!bread) throw new Error("fixture");
    bread.portions = [{ label: "2 slices", carbs: 70 }];
    const sheet = await edit();
    expect(sheet.getByTestId("total-bar")).toHaveTextContent("50 g");
    fireEvent.change(sheet.getByLabelText("Note"), { target: { value: "New note" } });
    fireEvent.click(sheet.getByRole("button", { name: "Gem" }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    expect(writes()[0]?.body).not.toHaveProperty("items");
    expect(writes()[0]?.body).toMatchObject({ note: "New note" });
  });

  it("shows current library nutrition before a quantity edit replaces the items", async () => {
    const bread = view.editItems[0];
    if (!bread) throw new Error("fixture");
    bread.portions = [{ label: "2 slices", carbs: 70 }];
    const sheet = await edit();
    fireEvent.change(sheet.getByLabelText("Kulhydrat · Cheese"), { target: { value: "2" } });
    expect(sheet.getByTestId("total-bar")).toHaveTextContent("86 g");
    fireEvent.click(sheet.getByRole("button", { name: "Gem" }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    expect((writes()[0]?.body as { items: unknown[] }).items[0]).toMatchObject({
      foodId: "bread",
      carbs: 70,
    });
  });

  it("keeps a food association when a saved portion no longer exists", async () => {
    const item = view.editItems[0];
    if (!item) throw new Error("Missing fixture item");
    item.portions = [{ label: "New slice", carbs: 20 }];
    const sheet = await edit();
    fireEvent.change(sheet.getByLabelText("Kulhydrat · Cheese"), { target: { value: "2" } });
    fireEvent.click(sheet.getByRole("button", { name: "Gem" }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    expect((writes()[0]?.body as { items: unknown[] }).items[0]).toEqual({
      foodId: "bread",
      name: "Rye bread",
      carbs: 36,
    });
  });

  it("uploads a changed photo only on Save and includes a newly recorded timestamp", async () => {
    view.meal = mealView({ bolusTs: undefined });
    const sheet = await edit();
    fireEvent.change(sheet.getByLabelText("Vedhæft billede"), {
      target: { files: [new File(["fictional"], "meal.png", { type: "image/png" })] },
    });
    await waitFor(() =>
      expect(sheet.getByRole("img", { name: view.meal.title })).toHaveAttribute(
        "src",
        "data:image/jpeg;base64,AQID",
      ),
    );
    expect(writes()).toEqual([]);
    fireEvent.click(sheet.getByRole("button", { name: "Bolus givet nu" }));
    fireEvent.click(sheet.getByRole("button", { name: "Gem" }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    expect(writes()[0]?.body).toMatchObject({
      photoDataUrl: "data:image/jpeg;base64,AQID",
      bolusTs: shift(MEAL_TS, 360),
    });
  });

  it("retries reading a saved edit without writing it twice", async () => {
    const sheet = await edit();
    fake.on("GET /api/spaces/s1/meals/m1/curve", {}, 500);
    fireEvent.click(sheet.getByRole("button", { name: "Gem" }));
    expect(await sheet.findByRole("alert")).toHaveTextContent(
      "Måltidet er gemt, men kunne ikke hentes – prøv igen",
    );
    fake.on("GET /api/spaces/s1/meals/m1/curve", view);
    fireEvent.click(sheet.getByRole("button", { name: "Hent måltidet igen" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(writes()).toHaveLength(1);
  });

  it("calculates weighed carbs, removes an item and sends grams without the old portion", async () => {
    const sheet = await edit("desktop");
    fireEvent.change(sheet.getByLabelText("Gram"), { target: { value: "50" } });
    fireEvent.click(sheet.getByRole("button", { name: "Fjern Apple" }));
    expect(sheet.getByTestId("total-bar")).toHaveTextContent("20 g");
    fireEvent.click(sheet.getByRole("button", { name: "Gem" }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    expect(writes()[0]?.body).toMatchObject({
      items: [
        { name: "Rye bread", foodId: "bread", grams: 50, carbs: 20 },
        { name: "Cheese", portionLabel: "1 slice", carbs: 0 },
      ],
    });
  });
  it("enumerates every field and keeps invalid carbs from saving", async () => {
    const sheet = await edit("desktop");
    const dialog = screen.getByRole("dialog");
    expect(
      [...dialog.querySelectorAll("input, textarea")].map((e) => [
        e.tagName,
        e.getAttribute("type"),
        e.getAttribute("name"),
      ]),
    ).toEqual([
      ["INPUT", "number", "grams-0"],
      ["INPUT", "number", "carbs-1"],
      ["INPUT", "time", "ts"],
      ["TEXTAREA", null, "note"],
      ["INPUT", "file", null],
      ["INPUT", "file", null],
    ]);
    fireEvent.change(sheet.getByLabelText("Kulhydrat · Cheese"), { target: { value: "" } });
    expect(sheet.getByRole("button", { name: "Gem" })).toBeDisabled();
    expect(writes()).toEqual([]);
  });
  it("keeps edits on failed save and can retry", async () => {
    fake.on("PATCH /api/spaces/s1/meals/m1", {}, 500);
    const sheet = await edit();
    fireEvent.change(sheet.getByLabelText("Note"), { target: { value: "Keep this" } });
    fireEvent.click(sheet.getByRole("button", { name: "Gem" }));
    expect(await sheet.findByRole("alert")).toHaveTextContent(
      "Måltidet blev ikke gemt – prøv igen",
    );
    expect(sheet.getByLabelText("Note")).toHaveValue("Keep this");
    fake.on("PATCH /api/spaces/s1/meals/m1", {});
    fireEvent.click(sheet.getByRole("button", { name: "Gem" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
  it("records a new tap, undoes it and omits an unchanged absent timestamp", async () => {
    view.meal = mealView({ bolusTs: undefined });
    const sheet = await edit();
    fireEvent.click(sheet.getByRole("button", { name: "Bolus givet nu" }));
    expect(sheet.getByText("Bolus 18:00")).toBeVisible();
    fireEvent.click(sheet.getByRole("button", { name: "Fortryd" }));
    fireEvent.click(sheet.getByRole("button", { name: "Gem" }));
    await waitFor(() => {
      expect(writes()).toHaveLength(1);
    });
    expect(writes()[0]?.body).not.toHaveProperty("bolusTs");
  });
  it("asks before deleting, cancels safely, reports failure and goes to Now after success", async () => {
    const sheet = await edit();
    fireEvent.click(sheet.getByRole("button", { name: "Slet måltid" }));
    expect(sheet.getByText("Slet måltidet? Det kan ikke fortrydes.")).toBeVisible();
    fireEvent.click(sheet.getByRole("button", { name: "Annullér" }));
    expect(writes()).toEqual([]);
    fake.on("DELETE /api/spaces/s1/meals/m1", {}, 500);
    fireEvent.click(sheet.getByRole("button", { name: "Slet måltid" }));
    fireEvent.click(sheet.getByRole("button", { name: "Ja, slet" }));
    expect(await sheet.findByRole("alert")).toHaveTextContent(
      "Måltidet blev ikke slettet – prøv igen",
    );
    expect(nav.push).not.toHaveBeenCalled();
    fake.on("DELETE /api/spaces/s1/meals/m1", null, 204);
    fireEvent.click(sheet.getByRole("button", { name: "Ja, slet" }));
    await waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith("/da/now");
    });
    expect(writes().map((c) => c.method)).toEqual(["DELETE", "DELETE"]);
  });
  it("opens with E, ignores shortcuts while editing, closes with Escape and returns focus", async () => {
    mount("desktop");
    const button = await screen.findByRole("button", { name: "Ret E" });
    button.focus();
    fireEvent.keyDown(window, { key: "e" });
    const sheet = within(screen.getByRole("dialog"));
    fireEvent.keyDown(sheet.getByLabelText("Note"), { key: "ArrowLeft" });
    expect(nav.push).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(button).toHaveFocus();
  });
});

describe("compare and navigation", () => {
  it("shows the current row first with clock and peak age, toggles table and opens previous rows", async () => {
    mount("desktop");
    const table = await screen.findByRole("table");
    expect(table).toHaveAccessibleName("De sidste 2 gange med Rye bread with cheese and an apple");
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(4);
    if (!rows[1] || !rows[2]) throw new Error("Missing comparison rows");
    expect(rows[1]).toHaveTextContent("I dag 12:00");
    expect(rows[1]).toHaveAttribute("data-current", "true");
    expect(within(rows[1]).getByRole("img", { name: /Top 9,6 kl. 13:05/ })).toBeVisible();
    fireEvent.keyDown(rows[2], { key: "Enter" });
    expect(nav.push).toHaveBeenCalledWith("/da/meal/p2");
    fireEvent.click(screen.getByRole("radio", { name: "Kun denne gang" }));
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Sammen med de sidste 2 gange" }));
    expect(screen.getByRole("table")).toBeVisible();
  });
  it("links to the local meal day and navigates neighbours with buttons and arrows", async () => {
    view.meal.ts = "2026-10-14T23:30:00.000Z";
    view.neighbours = { previousMealId: "before", nextMealId: "after" };
    mount("desktop");
    expect(await screen.findByRole("link", { name: "← Historik" })).toHaveAttribute(
      "href",
      "/da/history?date=2026-10-15",
    );
    fireEvent.click(screen.getByRole("button", { name: "Forrige måltid" }));
    expect(nav.push).toHaveBeenLastCalledWith("/da/meal/before");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(nav.push).toHaveBeenLastCalledWith("/da/meal/after");
    fireEvent.keyDown(window, { key: "ArrowLeft", ctrlKey: true });
    expect(nav.push).toHaveBeenCalledTimes(2);
  });
  it("disables both ends and has no table without previous occurrences", async () => {
    view.previous = [];
    mount("desktop");
    expect(await screen.findByRole("button", { name: "Forrige måltid" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Næste måltid" })).toBeDisabled();
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe("save as own dish", () => {
  const food = {
    id: "dish1",
    name: "Fictional dish",
    origin: "family",
    verified: false,
    portions: [{ label: "1 portion", carbs: 50 }],
    favourite: false,
    updatedAt: MEAL_TS,
  };
  it("creates an unchecked family food once and links to the unchecked library", async () => {
    fake.on("POST /api/spaces/s1/foods", food, 201);
    mount("desktop");
    const save = await screen.findByRole("button", { name: "Gem som egen ret" });
    fireEvent.click(save);
    fireEvent.click(save);
    const link = await screen.findByRole("link", {
      name: "Gemt i biblioteket · Tjek den under Bibliotek",
    });
    expect(link).toHaveAttribute("href", "/da/library?filter=unverified");
    expect(save).toBeDisabled();
    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/api/spaces/s1/foods",
        body: {
          from: "library",
          name: view.meal.title,
          portions: [{ label: "1 portion", carbs: 50 }],
        },
      },
    ]);
  });
  it("offers a bounded editable name for a title the food contract cannot hold", async () => {
    view.meal.title = "Fictional meal ".repeat(20);
    fake.on("POST /api/spaces/s1/foods", food, 201);
    mount("desktop");
    const name = await screen.findByLabelText("Rettens navn");
    expect(name).toHaveAttribute("maxlength", "200");
    fireEvent.change(name, { target: { value: "Short fictional dish" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem som egen ret" }));
    await screen.findByRole("link", { name: /Gemt i biblioteket/ });
    expect(writes()[0]?.body).toMatchObject({ name: "Short fictional dish" });
  });
  it("retries a failed create", async () => {
    fake.on("POST /api/spaces/s1/foods", {}, 500);
    mount("desktop");
    const save = await screen.findByRole("button", { name: "Gem som egen ret" });
    fireEvent.click(save);
    expect(await screen.findByRole("alert")).toHaveTextContent("Kunne ikke gemme – prøv igen");
    fake.on("POST /api/spaces/s1/foods", food, 201);
    fireEvent.click(save);
    await screen.findByRole("link", { name: /Gemt i biblioteket/ });
    expect(writes()).toHaveLength(2);
  });
  it("copies the photo and retries its upload without creating a duplicate dish", async () => {
    view.meal.photo = {
      originalUrl: "https://photos.example.invalid/meal.jpg",
      thumbUrl: "https://photos.example.invalid/thumb.jpg",
    };
    let failPhoto = true;
    const photoWrites: RequestInit[] = [];
    const bytes = new Uint8Array([255, 216, 255, 217]);
    fake.on("POST /api/spaces/s1/foods", food, 201);
    const recordedFetch = fetch;
    vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
      if (input === "/da/meal/m1/photo?space=s1") return new Response(bytes);
      if (input === "/api/spaces/s1/foods/dish1/photo") {
        photoWrites.push(init);
        return new Response("{}", { status: failPhoto ? 500 : 200 });
      }
      return recordedFetch(input, init);
    });
    mount("desktop");
    const save = await screen.findByRole("button", { name: "Gem som egen ret" });
    fireEvent.click(save);
    await screen.findByRole("alert");
    expect(save).toBeEnabled();
    failPhoto = false;
    fireEvent.click(save);
    await screen.findByRole("link", { name: /Gemt i biblioteket/ });
    expect(writes()).toHaveLength(1);
    expect(photoWrites.map((call) => call.method)).toEqual(["PUT", "PUT"]);
    const buffer = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result as ArrayBuffer);
      };
      reader.readAsArrayBuffer(photoWrites[1]?.body as Blob);
    });
    expect(new Uint8Array(buffer)).toEqual(bytes);
    expect(save).toBeDisabled();
  });
});
