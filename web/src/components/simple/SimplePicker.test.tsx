import "@testing-library/jest-dom/vitest";

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { SimplePicker, type SimplePickerProps } from "./SimplePicker";
import { fakeApi, food, type FakeApi } from "./test-support";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, replace: vi.fn(), prefetch: vi.fn() }),
}));

const pack = food("pack", "Min madpakke", { portions: [{ label: "1 madpakke", carbs: 42 }] });
const oats = food("oats", "Havregrød", {
  portions: [
    { label: "lille skål", grams: 150, carbs: 18 },
    { label: "stor skål", grams: 250, carbs: 30 },
  ],
});
const pasta = food("pasta", "Pasta bolognese", { portions: [{ label: "1 tallerken", carbs: 55 }] });
const apple = food("apple", "Æble", { portions: [{ label: "1 stk", grams: 150, carbs: 14 }] });
/** An adult's favourite, eaten before, never ticked: it must never reach the picker. */
const cake = food("cake", "Chokoladekage", {
  verified: false,
  favourite: true,
  portions: [{ label: "1 stykke", carbs: 35 }],
});
/** Ticked, but only per 100 g: it would have to be weighed. */
const flour = food("flour", "Mel", { carbsPer100g: 70, portions: [] });

let api: FakeApi;
beforeEach(() => {
  navigation.push.mockClear();
  api = fakeApi({ foods: [cake, oats, pack, pasta, apple, flour], recent: ["cake", "pack"] });
  vi.stubGlobal("fetch", api.fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base: SimplePickerProps = { spaceId: "s1", locale: "da", simple: true };
function mount(props: Partial<SimplePickerProps> = {}, locale: AppLocale = "da") {
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <SimplePicker {...base} {...props} locale={locale} />
    </I18nProvider>,
  );
}
const tileNames = async () =>
  [...(await screen.findByTestId("eat-grid")).querySelectorAll("[class*=tileTitle]")].map(
    (title) => title.textContent,
  );

describe("Hvad spiser du? (Log-Simpel, simpleMode)", () => {
  it("shows the title, a close back to Nu, and verified foods recently eaten first, the first spanning both columns", async () => {
    mount();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hvad spiser du?");
    expect(await tileNames()).toEqual(["Min madpakke", "Havregrød", "Pasta bolognese", "Æble"]);
    const grid = screen.getByTestId("eat-grid");
    const first = grid.querySelector("button[aria-pressed]");
    expect(first?.parentElement?.className).toMatch(/hero/);
    expect(first).toHaveAttribute("data-size", "112");
    expect(grid.querySelectorAll("button[aria-pressed]")[1]).toHaveAttribute("data-size", "104");
    fireEvent.click(screen.getByRole("button", { name: "Luk" }));
    expect(navigation.push).toHaveBeenCalledWith("/da/now");
  });

  it("never shows an unverified food, not even a favourite that was eaten before, and reads only foods and capture availability", async () => {
    mount();
    await tileNames();
    expect(screen.queryByText("Chokoladekage")).toBeNull();
    expect(screen.queryByText("Ikke tjekket")).toBeNull();
    expect(screen.queryByText("Mel")).toBeNull();
    expect(new Set(api.calls.map((c) => `${c.method} ${c.path}`))).toEqual(
      new Set(["GET foods", "GET estimates"]),
    );
  });

  it("selects on tap (accent border and check) and shows '{name} · 42 g kulhydrat · Ja, det spiser jeg'", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Min madpakke/ }));
    const tile = screen.getByRole("button", { name: /Min madpakke/ });
    expect(tile).toHaveAttribute("aria-pressed", "true");
    expect(within(tile).getByTestId("selection-check")).toBeInTheDocument();
    const bar = screen.getByTestId("total-bar");
    expect(bar).toHaveAttribute("data-variant", "simple");
    expect(bar).toHaveTextContent("Min madpakke");
    expect(bar).toHaveTextContent("42 g kulhydrat");
    expect(within(bar).getByRole("button", { name: "Ja, det spiser jeg" })).toBeEnabled();
  });

  it("asks 'Hvor meget?' with the portions of a food that has several, before it can be confirmed", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Havregrød/ }));
    const confirm = screen.getByRole("button", { name: "Ja, det spiser jeg" });
    expect(confirm).toBeDisabled();
    // Before the child picks: a dash, never a fake "0 g".
    expect(screen.getByTestId("total-bar")).toHaveTextContent("Havregrød–");
    expect(screen.getByTestId("total-bar")).not.toHaveTextContent("0 g");
    // The chips sit in the sticky footer with the chosen food, after the grid, not under it all.
    const footer = screen.getByTestId("eat-footer");
    const portions = within(footer).getByRole("region", { name: "Hvor meget?" });
    expect(
      screen.getByTestId("eat-grid").compareDocumentPosition(footer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(within(portions).getByRole("button", { name: "stor skål · 30 g" }));
    expect(screen.getByTestId("total-bar")).toHaveTextContent("30 g kulhydrat");
    expect(within(portions).queryByText("Vej det")).toBeNull();
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith("/da/now");
    });
    const post = api.calls.find((c) => c.method === "POST");
    expect(post?.body).toMatchObject({
      items: [{ foodId: "oats", name: "Havregrød", portionLabel: "stor skål", carbs: 30 }],
    });
  });

  it("asks 'Spiser om' at the simple size, 15 min chosen, and stamps the meal from the save moment (issue #191)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T10:10:00.000Z"));
    try {
      mount();
      fireEvent.click(await screen.findByRole("button", { name: /Min madpakke/ }));
      const footer = screen.getByTestId("eat-footer");
      const chips = within(footer).getByTestId("eating-in");
      expect(chips).toHaveAttribute("data-simple", "true");
      const group = within(chips).getByRole("radiogroup", { name: "Spiser om" });
      expect(
        within(group)
          .getAllByRole("radio")
          .map((r) => r.textContent),
      ).toEqual(["nu", "5 min", "10 min", "15 min", "20 min"]);
      expect(within(group).getByRole("radio", { name: "15 min" })).toBeChecked();
      fireEvent.click(within(group).getByRole("radio", { name: "5 min" }));
      vi.setSystemTime(new Date("2026-10-14T10:12:00.000Z"));
      fireEvent.click(screen.getByRole("button", { name: "Ja, det spiser jeg" }));
      await waitFor(() => {
        expect(navigation.push).toHaveBeenCalledWith("/da/now");
      });
      const post = api.calls.find((c) => c.method === "POST");
      expect(post?.body).toEqual({
        ts: "2026-10-14T10:17:00.000Z",
        items: [{ foodId: "pack", name: "Min madpakke", portionLabel: "1 madpakke", carbs: 42 }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends no time for 'nu', so the server stamps the save moment", async () => {
    mount({ simple: false });
    fireEvent.click(await screen.findByRole("button", { name: /Min madpakke/ }));
    expect(screen.getByTestId("eating-in")).toHaveAttribute("data-simple", "false");
    fireEvent.click(screen.getByRole("radio", { name: "nu" }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, det spiser jeg" }));
    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith("/da/now");
    });
    expect(api.calls.find((c) => c.method === "POST")?.body).not.toHaveProperty("ts");
  });

  it("saves through POST meals without a bolus time and goes back to Nu", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Min madpakke/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, det spiser jeg" }));
    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith("/da/now");
    });
    const writes = api.calls.filter((c) => c.method !== "GET");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe("meals");
    expect(writes[0]?.body).not.toHaveProperty("bolusTs");
    expect(JSON.stringify(writes[0]?.body)).not.toMatch(/bolus/i);
  });

  it("says 'Det blev ikke gemt – prøv igen' when the save fails, and stays", async () => {
    api.failing.add("POST meals");
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Min madpakke/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ja, det spiser jeg" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Det blev ikke gemt – prøv igen");
    expect(navigation.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Ja, det spiser jeg" })).toBeEnabled();
  });

  it("'Find noget andet' reveals a search over the same verified list", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Find noget andet" }));
    expect(screen.queryByRole("button", { name: "Find noget andet" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox", { name: "Søg i din mad" }), {
      target: { value: "aeble" },
    });
    expect(await tileNames()).toEqual(["Æble"]);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "kage" } });
    expect(screen.getByText("Ingen tjekket mad passer til det, du søger efter.")).toBeVisible();
  });

  it("explains an empty picker: no verified food yet", async () => {
    api.foods = [cake];
    mount();
    expect(await screen.findByTestId("eat-empty")).toHaveTextContent(
      "Der er ingen tjekket mad endnu – bed en voksen om at tjekke noget mad i biblioteket",
    );
  });

  it("offers a retry when the foods cannot be loaded", async () => {
    api.failing.add("GET foods");
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("Maden kunne ikke hentes lige nu.");
    api.failing.clear();
    fireEvent.click(screen.getByRole("button", { name: "Prøv igen" }));
    expect(await tileNames()).toHaveLength(4);
  });

  it("arrives with a food selected from a 'Min mad' tile (?food=)", async () => {
    mount({ initialFoodId: "pasta" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Pasta bolognese/ })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(screen.getByTestId("total-bar")).toHaveTextContent("55 g kulhydrat");
  });

  it("is the same picker without the simple sizes outside simpleMode, and speaks English", async () => {
    mount({ simple: false }, "en");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("What are you eating?");
    expect(screen.getByTestId("eat")).toHaveAttribute("data-simple", "false");
    const grid = await screen.findByTestId("eat-grid");
    expect(grid.querySelector("button[aria-pressed]")).toHaveAttribute("data-size", "104");
    expect(grid.querySelectorAll("button[aria-pressed]")[1]).toHaveAttribute("data-size", "92");
    fireEvent.click(screen.getByRole("button", { name: /Apple|Æble/ }));
    expect(screen.getByTestId("total-bar")).not.toHaveAttribute("data-size");
    expect(screen.getByRole("button", { name: "Yes, I'm eating that" })).toBeEnabled();
  });
});

describe("boundaries (plan task 9 hard rules)", () => {
  const web = path.resolve(import.meta.dirname, "../..");
  const roots = [
    import.meta.dirname,
    path.join(web, "app/[locale]/(app)/eat"),
    path.join(web, "app/[locale]/(app)/now"),
    path.join(web, "components/shell"),
  ];
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name) &&
        entry.name !== "test-support.ts"
        ? [full]
        : [];
    });

  it("eat, now, shell and the picker reach no database and write only through the meals route", () => {
    const files = roots.flatMap(sources);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/@prisma\/client|\bprisma\b\.|@\/lib\/(foods|meals)|\bemit\(/);
    }
  });

  it("the picker and Nu never send a bolus time and mount no bolus control", () => {
    for (const file of [...sources(import.meta.dirname), ...sources(roots[2] ?? "")]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/bolusTs\s*:|BolusTap/);
    }
  });

  it("colours the picker from the tokens only, so dark mode and every accent follow", () => {
    const css = readFileSync(path.join(import.meta.dirname, "simple.module.css"), "utf8");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
