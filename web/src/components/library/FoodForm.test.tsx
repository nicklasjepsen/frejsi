import "@testing-library/jest-dom/vitest";

import type { FoodView } from "@frejsi/shared/schemas/food";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";

import { FoodEditScreen } from "./FoodEditScreen";
import { FoodForm, parseDecimal } from "./FoodForm";
import { artboardFoods, fakeFoodsApi, type FakeFoodsApi } from "./test-support";

vi.mock("@/lib/photos/downscale", () => ({
  // jsdom's Blob has no arrayBuffer(); the kit only needs that one method.
  downscale: () =>
    Promise.resolve({
      arrayBuffer: () => Promise.resolve(new Uint8Array([0xff, 0xd8, 0xff]).buffer),
    }),
}));
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigation.push,
    replace: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
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
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  navigation.push.mockReset();
});

const food = (id: string): FoodView => {
  const found = artboardFoods().find((row) => row.id === id);
  if (!found) throw new Error(id);
  return found;
};
const mount = (props: { food?: FoodView; onSaved?: (food: FoodView) => void }) =>
  render(
    <I18nProvider locale="da" messages={getMessages("da")}>
      <FoodForm
        spaceId="s1"
        onSaved={props.onSaved ?? vi.fn()}
        {...(props.food ? { food: props.food } : {})}
      />
    </I18nProvider>,
  );
const writes = () => api.calls.filter((call) => call.method !== "GET");

describe("FoodForm (the edit panel's fields)", () => {
  it("reads 40,5 and 40.5 alike (5.49 g of carbohydrate in a portion saves as 5)", () => {
    expect(parseDecimal("40,5")).toBe(40.5);
    expect(parseDecimal(" 17 ")).toBe(17);
    expect(parseDecimal("abc")).toBeUndefined();
  });

  it("saves first-class portions: carbs computed from per 100 g when grams are given, typed when not", async () => {
    const onSaved = vi.fn();
    mount({ food: food("f-rye"), onSaved });
    expect(screen.getByLabelText("Navn")).toHaveValue("Rugbrød, Eksempelbageriet");
    expect(screen.getByLabelText("Kulhydrat pr. 100 g")).toHaveValue("40");
    // 45 g at 40 g per 100 g is 18 g; the computed amount is shown, not asked for.
    expect(screen.getByText("18 g kulhydrat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Portion" }));
    const second = at(screen.getAllByTestId("portion-row"), 1);
    fireEvent.change(within(second).getByLabelText("Portion"), { target: { value: "1 bid" } });
    fireEvent.change(within(second).getByLabelText("g kulhydrat"), { target: { value: "5.49" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Favorit" }));
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(writes()).toEqual([
      expect.objectContaining({
        method: "PATCH",
        path: "foods/f-rye",
        body: {
          name: "Rugbrød, Eksempelbageriet",
          carbsPer100g: 40,
          portions: [
            { label: "1 skive", grams: 45, carbs: 18 },
            { label: "1 bid", carbs: 5 },
          ],
          favourite: true,
        },
      }),
    ]);
  });

  it("previews a picked photo and sends it to PUT foods/[id]/photo only when saved", async () => {
    const onSaved = vi.fn();
    mount({ food: food("f-potato"), onSaved });
    fireEvent.change(screen.getByLabelText("Vedhæft billede", { selector: "input" }), {
      target: { files: [new File(["x"], "potato.jpg", { type: "image/jpeg" })] },
    });
    expect(await screen.findByRole("img", { name: "Det valgte billede" })).toHaveAttribute(
      "src",
      "blob:preview",
    );
    expect(api.calls.filter((call) => call.path.endsWith("/photo"))).toEqual([]);
    // The only call so far is the harmless question which corrections the deployment can take.
    expect(api.calls.filter((call) => call.path !== "contributions")).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
      "PATCH foods/f-potato",
      "PUT foods/f-potato/photo",
    ]);
    expect(onSaved.mock.calls[0]?.[0]).toMatchObject({
      photo: { thumbUrl: "https://photos.example.invalid/f-potato/thumb.jpg" },
    });
    // The revoked preview gives way once the photo is stored.
    await waitFor(() => {
      expect(screen.queryByRole("img", { name: "Det valgte billede" })).toBeNull();
    });
  });

  it("keeps the form and says so when the save fails", async () => {
    api.failing.add("PATCH foods/:id");
    const onSaved = vi.fn();
    mount({ food: food("f-potato"), onSaved });
    fireEvent.change(screen.getByLabelText("Navn"), { target: { value: "Kartofler, kogte" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem og godkend" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Kunne ikke gemme – prøv igen");
    expect(screen.getByLabelText("Navn")).toHaveValue("Kartofler, kogte");
    expect(onSaved).not.toHaveBeenCalled();
    expect(api.callsTo("POST", /verify/)).toEqual([]);
    api.failing.clear();
    fireEvent.click(screen.getByRole("button", { name: "Gem og godkend" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(onSaved.mock.calls[0]?.[0]).toMatchObject({ name: "Kartofler, kogte", verified: true });
  });

  it("creates a new food without verified; Gem og godkend sends the explicit verify: true", async () => {
    const onSaved = vi.fn();
    mount({ onSaved });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Ny fødevare");
    fireEvent.change(screen.getByLabelText("Navn"), { target: { value: "Min madpakke" } });
    const row = screen.getByTestId("portion-row");
    fireEvent.change(within(row).getByLabelText("Portion"), { target: { value: "1 madpakke" } });
    fireEvent.change(within(row).getByLabelText("g kulhydrat"), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem og godkend" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(writes().map((call) => call.body)).toEqual([
      {
        name: "Min madpakke",
        portions: [{ label: "1 madpakke", carbs: 42 }],
        favourite: false,
        from: "library",
        verify: true,
      },
    ]);
  });

  it("asks for a name and for carbs before sending anything", () => {
    mount({});
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Skriv et navn.");
    fireEvent.change(screen.getByLabelText("Navn"), { target: { value: "Æble" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Skriv kulhydrat pr. 100 g eller mindst én portion med kulhydrat.",
    );
    expect(api.calls).toEqual([]);
  });

  it("reports a number it cannot read instead of sending it as empty", () => {
    mount({ food: food("f-rye") });
    fireEvent.change(screen.getByLabelText("Kulhydrat pr. 100 g"), { target: { value: "40..5" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Skriv tallet som fx 40 eller 40,5.");
    fireEvent.change(screen.getByLabelText("Kulhydrat pr. 100 g"), { target: { value: "140" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Skriv tallet som fx 40 eller 40,5.");
    expect(api.calls.filter((call) => call.path !== "contributions")).toEqual([]);
  });

  it("keeps a fractional portion weight as it is", async () => {
    const onSaved = vi.fn();
    mount({
      food: { ...food("f-rye"), portions: [{ label: "½ skive", grams: 22.5, carbs: 9 }] },
      onSaved,
    });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
    expect(writes()[0]?.body).toMatchObject({
      portions: [{ label: "½ skive", grams: 22.5, carbs: 9 }],
    });
  });

  it("offers only Gem on a verified food", () => {
    mount({ food: food("f-lunch") });
    expect(screen.getByText("Tjekket")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gem og godkend" })).toBeNull();
    expect(screen.getByRole("button", { name: "Gem" })).toBeInTheDocument();
  });
});

describe("FoodForm: Send rettelsen til Open Food Facts (spec §4, always behind the question)", () => {
  const box = () =>
    screen.queryByRole("checkbox", {
      name: "Send rettelsen til Open Food Facts, så andre får gavn af den",
    });
  const contributionCalls = () => api.calls.filter((call) => call.path === "contributions");
  const posts = () => api.callsTo("POST", /^contributions$/);
  const saved = async (onSaved: ReturnType<typeof vi.fn>) => {
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
  };

  it("shows the box for an off food only when GET contributions lists off, unchecked", async () => {
    api.available = ["off"];
    mount({ food: food("f-rye") });
    const send = await screen.findByRole("checkbox", {
      name: /Send rettelsen til Open Food Facts/,
    });
    expect(send).not.toBeChecked();
    expect(contributionCalls().map((call) => call.method)).toEqual(["GET"]);
    // The same checkbox as Favorit: one shared control, not a native box beside a styled one.
    const favourite = screen.getByRole("checkbox", { name: "Favorit" });
    expect(send.closest("label")?.className).toMatch(/checkbox/);
    expect(send.closest("label")?.className).toBe(favourite.closest("label")?.className);
    // The source line shows the whole barcode, not four digits and an ellipsis.
    expect(screen.getByText("Open Food Facts · stregkode 2000000000015")).toBeInTheDocument();
  });

  it("hides the box when nothing is available, and for family, manual and frida foods", async () => {
    mount({ food: food("f-rye") });
    await waitFor(() => {
      expect(contributionCalls()).toHaveLength(1);
    });
    expect(box()).toBeNull();
    cleanup();
    api.available = ["off"];
    for (const id of ["f-pasta", "f-porridge", "f-potato"]) {
      mount({ food: food(id) });
      await waitFor(() => {
        expect(screen.getByLabelText("Navn")).toBeInTheDocument();
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(box()).toBeNull();
      cleanup();
    }
    expect(posts()).toEqual([]);
  });

  it("names no plugin: an origin the route lists gets the box, labelled by its id", async () => {
    api.available = ["x"];
    mount({ food: { ...food("f-rye"), origin: "x" } });
    expect(
      await screen.findByRole("checkbox", {
        name: "Send rettelsen til x, så andre får gavn af den",
      }),
    ).toBeInTheDocument();
  });

  it.each([
    ["Gem", false],
    ["Gem og godkend", true],
  ])(
    "saves first, then sends once, when the box is ticked and %s is pressed",
    async (label, verify) => {
      api.available = ["off"];
      const onSaved = vi.fn();
      mount({ food: food("f-rye"), onSaved });
      fireEvent.click(await screen.findByRole("checkbox", { name: /Send rettelsen/ }));
      fireEvent.change(screen.getByLabelText("Kulhydrat pr. 100 g"), { target: { value: "41" } });
      fireEvent.click(screen.getByRole("button", { name: label }));
      await saved(onSaved);
      expect(writes().map((call) => `${call.method} ${call.path}`)).toEqual([
        "PATCH foods/f-rye",
        ...(verify ? ["POST foods/verify"] : []),
        "POST contributions",
      ]);
      expect(posts()[0]?.body).toEqual({ foodId: "f-rye" });
      expect(await screen.findByTestId("contribution-outcome")).toHaveTextContent(
        "Sendt til Open Food Facts · tak",
      );
      expect(onSaved.mock.calls[0]?.[2]).toBe("sent");
      // Not remembered: the next save asks again.
      expect(screen.getByRole("checkbox", { name: /Send rettelsen/ })).not.toBeChecked();
    },
  );

  it("never sends from an unticked save", async () => {
    api.available = ["off"];
    const onSaved = vi.fn();
    mount({ food: food("f-rye"), onSaved });
    await screen.findByRole("checkbox", { name: /Send rettelsen/ });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    await saved(onSaved);
    fireEvent.click(screen.getByRole("button", { name: "Gem og godkend" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(2);
    });
    expect(posts()).toEqual([]);
    expect(screen.queryByTestId("contribution-outcome")).toBeNull();
  });

  it("does not remember a ticked box across saves", async () => {
    api.available = ["off"];
    const onSaved = vi.fn();
    mount({ food: food("f-rye"), onSaved });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Send rettelsen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    await saved(onSaved);
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(2);
    });
    expect(posts()).toHaveLength(1);
    // A fresh open starts unticked as well.
    cleanup();
    mount({ food: food("f-rye") });
    expect(await screen.findByRole("checkbox", { name: /Send rettelsen/ })).not.toBeChecked();
  });

  it("says the fix is saved here when the send fails, with the saved food intact", async () => {
    api.available = ["off"];
    api.failing.add("POST contributions");
    const onSaved = vi.fn();
    mount({ food: food("f-rye"), onSaved });
    fireEvent.click(await screen.findByRole("checkbox", { name: /Send rettelsen/ }));
    fireEvent.change(screen.getByLabelText("Kulhydrat pr. 100 g"), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    await saved(onSaved);
    expect(await screen.findByTestId("contribution-outcome")).toHaveTextContent(
      "Kunne ikke sende til Open Food Facts – rettelsen er gemt her",
    );
    expect(onSaved.mock.calls[0]?.[0]).toMatchObject({ id: "f-rye", carbsPer100g: 42 });
    expect(api.foods.find((row) => row.id === "f-rye")?.carbsPer100g).toBe(42);
    expect(screen.getByLabelText("Kulhydrat pr. 100 g")).toHaveValue("42");
    expect(onSaved.mock.calls[0]?.[2]).toBe("failed");
  });

  it("does not offer the send for an unsaved new food", async () => {
    api.available = ["off"];
    mount({});
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(box()).toBeNull();
    expect(api.calls).toEqual([]);
  });

  it("the phone page stays open to show the result of a send, and goes back otherwise", async () => {
    api.available = ["off"];
    render(
      <I18nProvider locale="da" messages={getMessages("da")}>
        <FoodEditScreen spaceId="s1" locale="da" foodId="f-rye" />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole("checkbox", { name: /Send rettelsen/ }));
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    expect(await screen.findByTestId("contribution-outcome")).toHaveTextContent(
      "Sendt til Open Food Facts",
    );
    expect(navigation.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));
    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith("/da/library");
    });
    expect(posts()).toHaveLength(1);
  });
});

describe("FoodEditScreen (the phone pages library/new and library/[foodId])", () => {
  const mountPage = (foodId?: string) =>
    render(
      <I18nProvider locale="da" messages={getMessages("da")}>
        <FoodEditScreen spaceId="s1" locale="da" {...(foodId ? { foodId } : {})} />
      </I18nProvider>,
    );

  it("loads the food, saves through the routes and goes back to the list", async () => {
    mountPage("f-pasta");
    expect(await screen.findByLabelText("Navn")).toHaveValue("Pasta bolognese");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Ret fødevare");
    fireEvent.click(screen.getByRole("button", { name: "Gem og godkend" }));
    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith("/da/library");
    });
    expect(api.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET foods/f-pasta",
      "PATCH foods/f-pasta",
      "POST foods/verify",
    ]);
  });

  it("starts empty for a new food and goes back with the arrow", () => {
    mountPage();
    const title = screen.getByRole("heading", { level: 1 });
    expect(title).toHaveTextContent("Ny fødevare");
    // The page header is the one title: the form has no second "Ny fødevare" and is named by it.
    expect(screen.getAllByText("Ny fødevare")).toHaveLength(1);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.getByRole("form", { name: "Ny fødevare" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tilbage" }));
    expect(navigation.push).toHaveBeenCalledWith("/da/library");
    expect(api.calls).toEqual([]);
  });

  it("says so when the food cannot be loaded", async () => {
    mountPage("missing");
    expect(await screen.findByRole("alert")).toHaveTextContent("Fødevaren kunne ikke hentes");
  });
});
