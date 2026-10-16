import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { LibraryScreen } from "./LibraryScreen";
import { artboardFoods, fakeFoodsApi, type FakeFoodsApi } from "./test-support";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/da/library",
}));

function at<T>(list: readonly T[], index: number): T {
  const item = list[index];
  if (item === undefined) throw new Error(`no item ${String(index)}`);
  return item;
}

let api: FakeFoodsApi;
beforeEach(() => {
  api = fakeFoodsApi(artboardFoods());
  vi.stubGlobal("fetch", api.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = (locale: AppLocale = "da", initialFilter = "all") =>
  render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <LibraryScreen spaceId="s1" locale={locale} initialFilter={initialFilter} />
    </I18nProvider>,
  );
const phone = () => within(screen.getByTestId("library-phone"));
const desktop = () => within(screen.getByTestId("library-desktop"));
const lists = () => api.callsTo("GET", /^foods$/);

async function phoneRows() {
  await waitFor(() => {
    expect(phone().getAllByTestId("food-row")).toHaveLength(5);
  });
  return phone().getAllByTestId("food-row");
}

describe("Bibliotek on the phone (Bibliotek-Telefon)", () => {
  it("draws Mad with +, the search, the filter chips from the origins present and the food rows in the artboard's forms", async () => {
    mount();
    const rows = await phoneRows();
    expect(phone().getByRole("heading", { level: 1 })).toHaveTextContent("Mad");
    expect(phone().getByRole("link", { name: "Ny fødevare" })).toHaveAttribute(
      "href",
      "/da/library/new",
    );
    expect(phone().getByRole("searchbox", { name: "Søg i mad" })).toBeInTheDocument();
    const chips = within(phone().getByRole("group", { name: "Vis" })).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Alle",
      "Ikke tjekket · 3",
      "Egne retter",
      "Favoritter",
      "Spist for nylig",
      "Fra Open Food Facts",
      "Fra Frida",
    ]);
    expect(chips[0]).toHaveAttribute("aria-pressed", "true");
    expect(chips[1]).toHaveAttribute("data-variant", "unverified");

    const text = rows.map((row) => row.textContent);
    expect(text[0]).toContain("Rugbrød, Eksempelbageriet");
    expect(text[0]).toContain("40 g pr. 100 g · 1 skive 45 g");
    expect(text[1]).toContain("Egen ret · 1 portion 55 g · ½ portion 28 g");
    expect(text[2]).toContain("Egen ret · 1 madpakke 42 g · vises i simpel visning");
    expect(text[3]).toContain("Frida · 17 g pr. 100 g");
    expect(text[4]).toContain("Egen ret · 10,5 g pr. 100 g · 1 skål 300 g");
    // The "Ikke tjekket" mark on every unverified food, and on no verified one.
    const marked = rows.map((row) => within(row).queryByText("Ikke tjekket") !== null);
    expect(marked).toEqual([true, true, false, true, false]);
    // A row opens its phone edit page.
    expect(
      within(at(rows, 0)).getByRole("link", { name: "Rugbrød, Eksempelbageriet" }),
    ).toHaveAttribute("href", "/da/library/f-rye");
    expect(lists()[0]?.query).toEqual({ filter: "all" });
  });

  it("ticks an unverified food with POST foods/verify and shows the filled check without reloading", async () => {
    mount();
    const [rye] = await phoneRows();
    if (!rye) throw new Error("no row");
    fireEvent.click(within(rye).getByRole("button", { name: "Godkend Rugbrød, Eksempelbageriet" }));
    await waitFor(() => {
      expect(within(rye).getByRole("img", { name: "Tjekket" })).toBeInTheDocument();
    });
    expect(api.callsTo("POST", /^foods\/verify$/).map((call) => call.body)).toEqual([
      { foodIds: ["f-rye"] },
    ]);
    expect(within(rye).queryByText("Ikke tjekket")).toBeNull();
    expect(phone().getByRole("button", { name: "Ikke tjekket · 2" })).toBeInTheDocument();
    expect(lists()).toHaveLength(1);
  });

  it("keeps the food unverified and says so when the tick fails", async () => {
    api.failing.add("POST foods/verify");
    mount();
    const [rye] = await phoneRows();
    if (!rye) throw new Error("no row");
    fireEvent.click(within(rye).getByRole("button", { name: /^Godkend/ }));
    expect(await phone().findByRole("alert")).toHaveTextContent("Det blev ikke gemt – prøv igen");
    expect(within(rye).getByText("Ikke tjekket")).toBeInTheDocument();
  });

  it("asks GET foods again for a filter and for what is typed", async () => {
    mount();
    await phoneRows();
    fireEvent.click(phone().getByRole("button", { name: "Ikke tjekket · 3" }));
    await waitFor(() => {
      expect(phone().getAllByTestId("food-row")).toHaveLength(3);
    });
    fireEvent.change(phone().getByRole("searchbox"), { target: { value: "kartof" } });
    await waitFor(() => {
      expect(phone().getAllByTestId("food-row")).toHaveLength(1);
    });
    expect(lists().map((call) => call.query)).toEqual([
      { filter: "all" },
      { filter: "unverified" },
      { filter: "unverified", q: "kartof" },
    ]);
    fireEvent.change(phone().getByRole("searchbox"), { target: { value: "zzz" } });
    expect(await phone().findByText("Ingen mad passer til det, du søger efter.")).toBeVisible();
  });

  it("shows the empty library with a line pointing to scanning and Ny fødevare", async () => {
    api.foods = [];
    mount();
    const empty = await phone().findByTestId("library-empty");
    expect(empty).toHaveTextContent("Biblioteket er tomt endnu");
    expect(empty).toHaveTextContent(/Scan en stregkode.*Ny fødevare/);
  });

  it("offers a retry when the list cannot be loaded", async () => {
    api.failing.add("GET foods");
    mount();
    expect(await phone().findByRole("alert")).toHaveTextContent("Biblioteket kunne ikke hentes");
    api.failing.clear();
    fireEvent.click(phone().getByRole("button", { name: "Prøv igen" }));
    await phoneRows();
  });

  it("speaks English with the en messages", async () => {
    mount("en");
    await waitFor(() => {
      expect(phone().getAllByTestId("food-row")).toHaveLength(5);
    });
    expect(phone().getByRole("heading", { level: 1 })).toHaveTextContent("Food");
    expect(phone().getByText("Frida · 17 g per 100 g")).toBeInTheDocument();
    expect(phone().getByRole("button", { name: "Not checked · 3" })).toBeInTheDocument();
  });
});

describe("Bibliotek on desktop (Bibliotek-Desktop)", () => {
  async function table() {
    await waitFor(() => {
      expect(desktop().getAllByRole("row")).toHaveLength(6);
    });
    return desktop().getAllByRole("row").slice(1);
  }

  it("draws the header with counts, the search with /, Ny fødevare, five chips, the hint and the columns", async () => {
    mount();
    await table();
    expect(desktop().getByRole("heading", { level: 1 })).toHaveTextContent("Bibliotek");
    expect(desktop().getByText("5 fødevarer · 3 ikke tjekket")).toBeInTheDocument();
    expect(desktop().getByRole("searchbox", { name: "Søg i biblioteket" })).toBeInTheDocument();
    expect(desktop().getByText("/", { selector: "kbd" })).toBeInTheDocument();
    expect(desktop().getByRole("button", { name: "Ny fødevare" })).toBeInTheDocument();
    const chips = within(desktop().getByRole("group", { name: "Vis" })).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Alle",
      "Ikke tjekket · 3",
      "Egne retter",
      "Fra Open Food Facts",
      "Fra Frida",
    ]);
    expect(
      desktop().getByText("J/K flytter · Mellemrum vælger · V godkender · E retter"),
    ).toBeInTheDocument();
    expect(
      desktop()
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["Vælg", "Fødevare", "Pr. 100 g", "Portioner", "Kilde", "Status"]);
    const rye = at(await table(), 0);
    expect(
      within(rye)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual([
      "",
      "Rugbrød, Eksempelbageriet",
      "40 g",
      "1 skive 45 g",
      "Open Food Facts",
      "Ikke tjekket",
    ]);
  });

  it("works from the keyboard: / searches, J/K move, Space selects, V approves the selection", async () => {
    mount();
    const rows = await table();
    fireEvent.keyDown(document.body, { key: "/" });
    expect(desktop().getByRole("searchbox")).toHaveFocus();
    desktop().getByRole<HTMLInputElement>("searchbox").blur();

    fireEvent.keyDown(document.body, { key: "j" });
    expect(at(rows, 0)).toHaveFocus();
    fireEvent.keyDown(at(rows, 0), { key: " " });
    fireEvent.keyDown(at(rows, 0), { key: "j" });
    expect(at(rows, 1)).toHaveFocus();
    fireEvent.keyDown(at(rows, 1), { key: "j" });
    fireEvent.keyDown(at(rows, 2), { key: "j" });
    fireEvent.keyDown(at(rows, 3), { key: " " });
    fireEvent.keyDown(at(rows, 3), { key: "k" });
    expect(at(rows, 2)).toHaveFocus();

    const bar = desktop().getByRole("region", { name: "2 valgt" });
    expect(bar).toHaveTextContent("2 valgt");
    expect(within(bar).getByRole("button", { name: /Godkend valgte/ })).toHaveTextContent("V");
    expect(within(bar).getByRole("button", { name: "Fjern fra biblioteket" })).toBeInTheDocument();

    fireEvent.keyDown(at(rows, 2), { key: "v" });
    await waitFor(() => {
      expect(desktop().queryByRole("region", { name: /valgt/ })).toBeNull();
    });
    expect(api.callsTo("POST", /^foods\/verify$/).map((call) => call.body)).toEqual([
      { foodIds: ["f-rye", "f-potato"] },
    ]);
    expect(within(at(rows, 0)).getByText("Tjekket")).toBeInTheDocument();
    expect(within(at(rows, 3)).getByText("Tjekket")).toBeInTheDocument();
    expect(desktop().getByText("5 fødevarer · 1 ikke tjekket")).toBeInTheDocument();
    expect(lists()).toHaveLength(1);
  });

  it("V without a selection approves the focused row; typing in the search never triggers it", async () => {
    mount();
    const rows = await table();
    fireEvent.keyDown(desktop().getByRole("searchbox"), { key: "v" });
    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(at(rows, 0), { key: "j" });
    fireEvent.keyDown(at(rows, 1), { key: "v" });
    await waitFor(() => {
      expect(within(at(rows, 1)).getByText("Tjekket")).toBeInTheDocument();
    });
    expect(api.callsTo("POST", /^foods\/verify$/).map((call) => call.body)).toEqual([
      { foodIds: ["f-pasta"] },
    ]);
  });

  it("E opens the edit panel for the focused row; Gem og godkend shows Tjekket without reloading", async () => {
    mount();
    const rows = await table();
    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(at(rows, 0), { key: "e" });
    const panel = within(desktop().getByTestId("edit-panel"));
    expect(panel.getByRole("heading", { level: 2 })).toHaveTextContent("Rugbrød, Eksempelbageriet");
    expect(panel.getByText("Open Food Facts · stregkode 2000…")).toBeInTheDocument();
    fireEvent.click(panel.getByRole("button", { name: "Gem og godkend" }));
    await waitFor(() => {
      expect(within(at(rows, 0)).getByText("Tjekket")).toBeInTheDocument();
    });
    const foodCalls = api.calls.filter((call) => call.path !== "contributions");
    expect(foodCalls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET foods",
      "PATCH foods/f-rye",
      "POST foods/verify",
    ]);
    expect(api.callsTo("POST", /^contributions$/)).toEqual([]);
    expect(foodCalls[1]?.body).not.toHaveProperty("verified");
    const after = within(desktop().getByTestId("edit-panel"));
    expect(after.getByText("Tjekket")).toBeInTheDocument();
    expect(after.queryByRole("button", { name: "Gem og godkend" })).toBeNull();
  });

  it("Ny fødevare opens an empty panel and adds the saved food to the table", async () => {
    mount();
    await table();
    fireEvent.click(desktop().getByRole("button", { name: "Ny fødevare" }));
    const panel = within(desktop().getByTestId("edit-panel"));
    fireEvent.change(panel.getByLabelText("Navn"), { target: { value: "Boller" } });
    fireEvent.change(panel.getByLabelText("Kulhydrat pr. 100 g"), { target: { value: "48" } });
    fireEvent.click(panel.getByRole("button", { name: "Gem" }));
    await waitFor(() => {
      expect(desktop().getAllByRole("row")).toHaveLength(7);
    });
    expect(api.callsTo("POST", /^foods$/)[0]?.body).toEqual({
      name: "Boller",
      carbsPer100g: 48,
      portions: [],
      favourite: false,
      from: "library",
    });
    expect(desktop().getByText("6 fødevarer · 4 ikke tjekket")).toBeInTheDocument();
  });

  it("removes the selected rows after one confirmation", async () => {
    mount();
    const rows = await table();
    fireEvent.click(within(at(rows, 4)).getByRole("checkbox"));
    const bar = within(desktop().getByRole("region", { name: "1 valgt" }));
    fireEvent.click(bar.getByRole("button", { name: "Fjern fra biblioteket" }));
    expect(api.callsTo("DELETE", /.*/)).toHaveLength(0);
    fireEvent.click(bar.getByRole("button", { name: "Ja, fjern" }));
    await waitFor(() => {
      expect(desktop().getAllByRole("row")).toHaveLength(5);
    });
    expect(api.callsTo("DELETE", /.*/).map((call) => call.path)).toEqual(["foods/f-porridge"]);
  });
});

describe("initial library filter (#122)", () => {
  it("selects unverified on phone and desktop and filters the first request", async () => {
    mount("da", "unverified");
    await waitFor(() => {
      expect(phone().getAllByTestId("food-row")).toHaveLength(3);
    });
    for (const layout of [phone(), desktop()]) {
      expect(layout.getByRole("button", { name: "Ikke tjekket · 3" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(layout.getByRole("button", { name: "Alle" })).toHaveAttribute("aria-pressed", "false");
      expect(layout.queryByText("Min madpakke")).toBeNull();
    }
    expect(lists().map((call) => call.query)).toEqual([{ filter: "unverified" }]);

    fireEvent.click(desktop().getByRole("button", { name: "Alle" }));
    await phoneRows();
    expect(phone().getByRole("button", { name: "Alle" })).toHaveAttribute("aria-pressed", "true");
  });

  it("selects an origin filter and returns only that origin from the first request", async () => {
    mount("da", "off");
    await waitFor(() => {
      expect(phone().getAllByTestId("food-row")).toHaveLength(1);
    });
    for (const layout of [phone(), desktop()]) {
      expect(layout.getByRole("button", { name: "Fra Open Food Facts" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
    expect(lists().map((call) => call.query)).toEqual([{ filter: "off" }]);
    expect(phone().getByText("Rugbrød, Eksempelbageriet")).toBeInTheDocument();
  });
});

describe("selected filters outside the default chips", () => {
  it.each([
    ["family", "Fra biblioteket", "From the library"],
    ["manual", "Fra måltidsloggen", "From the meal log"],
    ["favourites", "Favoritter", "Favourites"],
    ["recent", "Spist for nylig", "Eaten recently"],
    ["future-source", "Fra future-source", "From future-source"],
  ])("represents %s with an active chip in both layouts and locales", async (filter, da, en) => {
    for (const locale of ["da", "en"] as const) {
      const view = mount(locale, filter);
      for (const layout of [phone(), desktop()]) {
        expect(layout.getByRole("button", { name: locale === "da" ? da : en })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
      }
      await waitFor(() => {
        expect(lists().at(-1)?.query).toEqual({ filter });
      });
      view.unmount();
    }
  });
});

it("sends keyword while typing and semantic only on Enter, on both layouts", async () => {
  mount();
  await phoneRows();
  for (const view of [phone, desktop]) {
    const input = view().getByRole("searchbox");
    fireEvent.change(input, { target: { value: "det brune brød" } });
    await waitFor(() => {
      expect(lists().at(-1)?.query.q).toBe("det brune brød");
    });
    expect(lists().at(-1)?.query.mode).not.toBe("semantic");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => {
      expect(lists().at(-1)?.query.mode).toBe("semantic");
    });
    fireEvent.change(input, { target: { value: "pasta" } });
    await waitFor(() => {
      expect(lists().at(-1)?.query.q).toBe("pasta");
    });
    expect(lists().at(-1)?.query.mode).not.toBe("semantic");
  }
});
it("renders an asked photo as an approximate unchecked guess and shows its photo and portion in the editor", async () => {
  const asked = {
    ...at(artboardFoods(), 0),
    id: "asked",
    name: "Sky pasta",
    origin: "ai",
    verified: false,
    sourceName: undefined,
    createdBy: { id: "child", name: "Example child" },
    createdAt: "2026-10-15T12:00:00Z",
    carbsPer100g: 20,
    portions: [{ label: "1 plate", grams: 250, carbs: 50 }],
    photo: {
      thumbUrl: "https://example.invalid/thumb.jpg",
      originalUrl: "https://example.invalid/photo.jpg",
    },
  };
  api = fakeFoodsApi([asked]);
  vi.stubGlobal("fetch", api.fetch);
  mount();
  await waitFor(() => expect(phone().getByText("Sky pasta (fra billede)")).toBeInTheDocument());
  expect(phone().getByText(/ca\. 50 g · Example child spurgte/)).toBeInTheDocument();
  expect(phone().getByText("Et gæt · ikke tjekket")).toBeInTheDocument();
  expect(desktop().getByText("ca. 20 g")).toBeInTheDocument();
  expect(desktop().getByText("1 tallerken ca. 250 g")).toBeInTheDocument();
  expect(desktop().getByRole("cell", { name: "AI fra billede" })).toBeInTheDocument();
  expect(desktop().getByText("Et gæt")).toBeInTheDocument();
  fireEvent.click(desktop().getByRole("button", { name: "Ret Sky pasta" }));
  const panel = within(screen.getByTestId("edit-panel"));
  expect(panel.getByDisplayValue("250")).toBeInTheDocument();
  expect(panel.getByRole("presentation")).toHaveAttribute("src", asked.photo.thumbUrl);
});
it("the normalised source line retains the plugin's original name", async () => {
  const sourceName = "EXAMPLE WHOLE GRAIN LOAF 900G";
  api = fakeFoodsApi([{ ...at(artboardFoods(), 0), sourceName }]);
  vi.stubGlobal("fetch", api.fetch);
  mount();
  await waitFor(() =>
    expect(desktop().getByRole("button", { name: /Ret Rugbrød/ })).toBeInTheDocument(),
  );
  fireEvent.click(desktop().getByRole("button", { name: /Ret Rugbrød/ }));
  expect(
    within(screen.getByTestId("edit-panel")).getByText(`Open Food Facts · ${sourceName}`),
  ).toBeInTheDocument();
});
