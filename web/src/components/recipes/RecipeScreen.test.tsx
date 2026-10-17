import "@testing-library/jest-dom/vitest";
import type { FoodView, RecipeReview as Review } from "@frejsi/shared/schemas/food";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchFake, type FetchFake } from "@/components/meal/test-support";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";

import { RecipeScreen } from "./RecipeScreen";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

const review: Review = {
  title: "Eksempellasagne",
  approx: true,
  yieldPortions: 6,
  totalCarbs: 199,
  source: { kind: "text", text: "..." },
  lines: [
    {
      name: "lasagneplader",
      amount: 250,
      unit: "g",
      grams: 250,
      foodId: "f-pasta",
      foodName: "Lasagneplader",
      carbs: 175,
      match: {
        id: "f-pasta",
        name: "Lasagneplader",
        carbsPer100g: 70,
        portions: [],
        origin: "family",
        verified: true,
        favourite: false,
        createdAt: "2026-10-14T10:00:00.000Z",
        updatedAt: "2026-10-14T10:00:00.000Z",
      },
    },
    {
      name: "mælk",
      amount: 5,
      unit: "dl",
      grams: 500,
      foodName: "Mælk, Fiktiv",
      carbs: 24,
      candidates: [
        {
          name: "Mælk, Fiktiv",
          carbsPer100g: 4.8,
          portions: [],
          origin: "off",
          sourceRef: "off:1",
        },
      ],
    },
    { name: "salt og peber", carbs: 0, noCarb: true },
  ],
};
const dish: FoodView = {
  id: "f-dish",
  name: "Eksempellasagne",
  origin: "recipe",
  verified: false,
  favourite: false,
  carbsPer100g: 26.5,
  portions: [
    { label: "1 portion", grams: 125, carbs: 33 },
    { label: "½ portion", grams: 63, carbs: 17 },
  ],
  recipe: {
    ingredients: review.lines.map(({ match: _m, candidates: _c, ...line }) => line),
    yieldPortions: 6,
    source: review.source,
  },
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
};

function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`no item ${String(index)}`);
  return item;
}

let fake: FetchFake;
const writes = () => fake.calls.filter((call) => call.method !== "GET");
function mount(props: { mealId?: string; shareId?: string; foodId?: string } = {}) {
  return render(
    <I18nProvider locale="da" messages={getMessages("da")}>
      <RecipeScreen spaceId="s1" locale="da" {...props} />
    </I18nProvider>,
  );
}
beforeEach(() => {
  fake = fetchFake()
    .on("GET /api/spaces/s1/estimates", { available: true, carers: [] })
    .on("POST /api/spaces/s1/recipes/parse", review)
    .on("POST /api/spaces/s1/recipes", dish, 201)
    .on("PATCH /api/spaces/s1/recipes/f-dish", dish)
    .on("GET /api/spaces/s1/recipes/meal/m1", {
      ...review,
      approx: false,
      source: { kind: "meal", mealId: "m1" },
      yieldPortions: 1,
    })
    .on("GET /api/spaces/s1/foods/f-dish", dish)
    .on("GET /api/share/abc", { text: "500 g mel\n5 dl mælk", title: "Delt opskrift" });
  fake.install();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.push.mockReset();
});

describe("RecipeScreen (/recipe/new)", () => {
  it("shows the three ways in and reads pasted text only on the tap, then the lines with ca., the total and the yield", async () => {
    mount();
    await screen.findByRole("button", { name: "Tag et billede af opskriften" });
    expect(screen.getByLabelText("Link til opskriften")).toBeVisible();
    const text = screen.getByLabelText("Ingredienser");
    expect(writes()).toEqual([]);
    fireEvent.change(text, { target: { value: "250 g lasagneplader, 5 dl mælk, salt og peber" } });
    expect(writes()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Læs ingredienserne" }));
    expect(await screen.findByDisplayValue("Eksempellasagne")).toBeVisible();
    expect(writes()).toEqual([
      {
        method: "POST",
        path: "/api/spaces/s1/recipes/parse",
        body: { text: "250 g lasagneplader, 5 dl mælk, salt og peber" },
      },
    ]);
    const rows = screen.getAllByTestId("ingredient-row");
    expect(rows).toHaveLength(3);
    expect(within(at(rows, 0)).getByText("ca.")).toBeVisible();
    expect(within(at(rows, 0)).getByText("Fundet som Lasagneplader")).toBeVisible();
    expect(within(at(rows, 0)).getByText("175 g")).toBeVisible();
    expect(within(at(rows, 2)).getByText("Uden kulhydrat")).toBeVisible();
    expect(screen.getByText("199 g kulhydrat")).toBeVisible();
    expect(screen.getByLabelText("Portioner")).toHaveValue(6);
    expect(screen.getByText("1 portion · 33 g")).toBeVisible();
  });

  it("recomputes a line from an edited amount, drops its ca., removes a line and posts only on Gem", async () => {
    mount();
    fireEvent.change(await screen.findByLabelText("Ingredienser"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Læs ingredienserne" }));
    const rows = await screen.findAllByTestId("ingredient-row");
    const first = within(at(rows, 0));
    fireEvent.change(first.getByLabelText("Mængde"), { target: { value: "500" } });
    expect(first.getByText("350 g")).toBeVisible();
    expect(first.queryByText("ca.")).toBeNull();
    expect(screen.getByText("374 g kulhydrat")).toBeVisible();
    fireEvent.click(within(at(rows, 1)).getByRole("button", { name: "Fjern mælk" }));
    expect(screen.getAllByTestId("ingredient-row")).toHaveLength(2);
    expect(screen.getByText("350 g kulhydrat")).toBeVisible();
    expect(writes()).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Portioner"), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText("Én portion"), { target: { value: "1 tallerken" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    await screen.findByRole("status");
    const save = writes()[1];
    expect(save?.path).toBe("/api/spaces/s1/recipes");
    expect(save?.body).toEqual({
      title: "Eksempellasagne",
      ingredients: [
        {
          name: "lasagneplader",
          amount: 500,
          unit: "g",
          grams: 500,
          foodId: "f-pasta",
          foodName: "Lasagneplader",
          carbs: 350,
        },
        { name: "salt og peber", carbs: 0, noCarb: true },
      ],
      yieldPortions: 5,
      source: { kind: "text", text: "..." },
      portionLabels: { one: "1 tallerken", half: "½ portion" },
    });
    expect(screen.getByRole("link", { name: "Se den i biblioteket" })).toHaveAttribute(
      "href",
      "/da/library/f-dish",
    );
    expect(screen.getByRole("button", { name: "Gem" })).toBeDisabled();
  });

  it("changes a line's match by search", async () => {
    fake.on("GET /api/spaces/s1/lookup", {
      results: [
        {
          source: "library",
          verified: true,
          food: {
            id: "f-skim",
            name: "Skummetmælk",
            carbsPer100g: 5,
            portions: [],
            origin: "family",
            verified: true,
            favourite: false,
            createdAt: "2026-10-14T10:00:00.000Z",
            updatedAt: "2026-10-14T10:00:00.000Z",
          },
        },
      ],
      sources: {},
      manual: { name: "skummet" },
    });
    mount();
    fireEvent.change(await screen.findByLabelText("Ingredienser"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Læs ingredienserne" }));
    const rows = await screen.findAllByTestId("ingredient-row");
    const milk = within(at(rows, 1));
    fireEvent.click(milk.getByRole("button", { name: "Skift" }));
    fireEvent.change(milk.getByLabelText("Søg efter en vare til mælk"), {
      target: { value: "skummet" },
    });
    fireEvent.click(milk.getByRole("button", { name: "Søg" }));
    fireEvent.click(await milk.findByRole("button", { name: "Vælg Skummetmælk" }));
    expect(milk.getByText("Fundet som Skummetmælk")).toBeVisible();
    expect(milk.getByText("25 g")).toBeVisible();
    expect(
      fake.calls.find((call) => call.path.startsWith("/api/spaces/s1/lookup"))?.path,
    ).toContain("remote=true");
  });

  it("hides the photo and text ways when AI is off and keeps the link way", async () => {
    fake.on("GET /api/spaces/s1/estimates", { available: false, carers: [] });
    mount();
    expect(await screen.findByText(/Billede og tekst kræver AI-hjælp/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Tag et billede af opskriften" })).toBeNull();
    expect(screen.queryByLabelText("Ingredienser")).toBeNull();
    const url = screen.getByLabelText("Link til opskriften");
    fireEvent.change(url, { target: { value: "https://recipes.example/lasagne" } });
    fireEvent.click(screen.getByRole("button", { name: "Hent opskriften" }));
    await screen.findByDisplayValue("Eksempellasagne");
    expect(writes()[0]?.body).toEqual({ url: "https://recipes.example/lasagne" });
  });

  it("shows the route's error by its code and lets the person try again", async () => {
    fake.on(
      "POST /api/spaces/s1/recipes/parse",
      { error: { code: "recipe-fetch-failed", message: "x" } },
      502,
    );
    mount();
    const url = await screen.findByLabelText("Link til opskriften");
    fireEvent.change(url, { target: { value: "https://recipes.example/down" } });
    fireEvent.click(screen.getByRole("button", { name: "Hent opskriften" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Vi kunne ikke hente siden");
    expect(screen.getByRole("button", { name: "Hent opskriften" })).toBeEnabled();
  });

  it("?meal= opens the meal's items as lines with no parse call (Gem som opskrift)", async () => {
    mount({ mealId: "m1" });
    expect(await screen.findByDisplayValue("Eksempellasagne")).toBeVisible();
    expect(screen.getByText("Fra et måltid")).toBeVisible();
    expect(screen.getByLabelText("Portioner")).toHaveValue(1);
    expect(screen.queryByText("ca.")).toBeNull();
    expect(writes()).toEqual([]);
    expect(fake.calls.map((call) => call.path)).toContain("/api/spaces/s1/recipes/meal/m1");
  });

  it("?share= loads the share once into the text field, reading nothing until the tap; a spent share says so", async () => {
    mount({ shareId: "abc" });
    expect(await screen.findByLabelText("Ingredienser")).toHaveValue("500 g mel\n5 dl mælk");
    expect(screen.getByText("Delt fra en anden app")).toBeVisible();
    expect(writes()).toEqual([]);
    cleanup();
    fake.on("GET /api/share/abc", { error: { code: "share-expired", message: "x" } }, 410);
    mount({ shareId: "abc" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Det delte indhold er udløbet");
    expect(screen.queryByRole("button", { name: "Prøv igen" })).toBeNull();
  });

  it("edits a saved dish: its lines and portion names load, and Gem patches the recipe", async () => {
    mount({ foodId: "f-dish" });
    expect(await screen.findByRole("heading", { name: "Ret opskriften" })).toBeVisible();
    expect(screen.getAllByTestId("ingredient-row")).toHaveLength(3);
    expect(screen.getByLabelText("Én portion")).toHaveValue("1 portion");
    fireEvent.change(screen.getByLabelText("Portioner"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    await screen.findByRole("status");
    expect(writes()).toEqual([
      {
        method: "PATCH",
        path: "/api/spaces/s1/recipes/f-dish",
        body: {
          title: "Eksempellasagne",
          ingredients: dish.recipe?.ingredients,
          yieldPortions: 8,
          yieldGrams: null,
          portionLabels: { one: "1 portion", half: "½ portion" },
        },
      },
    ]);
  });

  it("refuses to save without a yield, and goes back to the library", async () => {
    mount({ mealId: "m1" });
    await screen.findByDisplayValue("Eksempellasagne");
    fireEvent.change(screen.getByLabelText("Portioner"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Skriv hvor mange portioner");
    expect(writes()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Tilbage" }));
    await waitFor(() => {
      expect(nav.push).toHaveBeenCalledWith("/da/library");
    });
  });
});
