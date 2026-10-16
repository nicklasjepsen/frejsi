import "@testing-library/jest-dom/vitest";
import type { FoodView, LookupResponse } from "@frejsi/shared/schemas/food";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import da from "../../../messages/da";
import en from "../../../messages/en";
import { BarcodeScanner } from "./BarcodeScanner";
import { BolusTap } from "./BolusTap";
import { addFood, emptyDraft } from "./draft";
import { EntryTiles } from "./EntryTiles";
import { LookupResults } from "./LookupResults";
import { ManualFoodForm } from "./ManualFoodForm";
import { PortionSheet } from "./PortionSheet";
import { TotalBar } from "./TotalBar";

/** Gives jsdom's navigator a camera for one test; removed again in afterEach. */
function stubMedia(media: unknown) {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: media });
}

const mount = (children: ReactNode, locale: "da" | "en" = "da") =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "da" ? da : en}>
      {children}
    </NextIntlClientProvider>,
  );

afterEach(() => {
  cleanup();
  delete (navigator as { mediaDevices?: unknown }).mediaDevices;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const own: FoodView = {
  id: "f-own",
  name: "Rugbrød med ost",
  portions: [{ label: "1 skive", carbs: 18 }],
  origin: "family",
  verified: true,
  favourite: true,
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
};
const response: LookupResponse = {
  results: [
    { source: "library", verified: true, food: own },
    {
      source: "off",
      verified: false,
      food: {
        name: "Rugbrød, Fiktivt Bageri",
        carbsPer100g: 40,
        portions: [{ label: "1 skive", grams: 45, carbs: 18 }],
        origin: "off",
        sourceRef: "off:2000000000015",
      },
    },
  ],
  sources: { off: "ok", frida: "timeout", usda: "rate-limited", other: "skipped" },
  manual: { name: "rugbrød" },
};

describe("EntryTiles", () => {
  it("draws three entry tiles and opens Say when AI is enabled", () => {
    const say = vi.fn();
    mount(<EntryTiles onScan={vi.fn()} onPick={vi.fn()} onSay={say} />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "Scan",
      "Sig det",
      "Vælg",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Sig det" }));
    expect(say).toHaveBeenCalledOnce();
  });

  it("draws Scan and Vælg when AI is unavailable", () => {
    const scan = vi.fn();
    const pick = vi.fn();
    mount(<EntryTiles onScan={scan} onPick={pick} />);
    fireEvent.click(screen.getByRole("button", { name: "Scan" }));
    fireEvent.click(screen.getByRole("button", { name: "Vælg" }));
    expect(scan).toHaveBeenCalledOnce();
    expect(pick).toHaveBeenCalledOnce();
    expect(screen.queryByText("Sig det")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });
});

describe("LookupResults", () => {
  it("lists results in the server's order with badge and source line, then the manual row", () => {
    const pick = vi.fn();
    const manual = vi.fn();
    mount(<LookupResults response={response} query="rugbrød" onPick={pick} onManual={manual} />);
    expect(screen.getByText("egne retter først")).toBeVisible();
    expect(screen.getByText("Egen ret · 1 skive · 18 g")).toBeVisible();
    expect(screen.getByText("Open Food Facts · 40 g pr. 100 g · 1 skive · 18 g")).toBeVisible();
    expect(screen.getAllByText("Ikke tjekket")).toHaveLength(1);
    const titles = screen.getAllByRole("button").map((b) => b.textContent);
    expect(titles).toEqual([
      "Rugbrød med ost",
      "Rugbrød, Fiktivt Bageri",
      'Jeg kender tallet selvOpret "rugbrød" med dine egne tal',
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Rugbrød, Fiktivt Bageri" }));
    expect(pick).toHaveBeenCalledWith(response.results[1]);
    fireEvent.click(screen.getByRole("button", { name: /Jeg kender tallet selv/ }));
    expect(manual).toHaveBeenCalledOnce();
  });

  it("names every source that did not answer, by its plugin name or its id", () => {
    mount(
      <LookupResults response={response} query="rugbrød" onPick={vi.fn()} onManual={vi.fn()} />,
    );
    const notices = screen.getAllByRole("status").map((n) => n.textContent);
    expect(notices).toEqual(["Frida svarer ikke lige nu", "usda svarer ikke lige nu"]);
  });

  it("counts results on desktop and marks the highlighted row", () => {
    mount(
      <LookupResults
        desktop
        response={response}
        query="rugbrød"
        highlighted={1}
        onPick={vi.fn()}
        onManual={vi.fn()}
      />,
    );
    expect(screen.getByText("2 resultater · egne retter først · Enter tilføjer")).toBeVisible();
    const rows = screen.getAllByRole("listitem");
    expect(rows[1]).toHaveAttribute("data-highlighted", "true");
  });
});

describe("PortionSheet", () => {
  const bread: FoodView = {
    ...own,
    id: "f-bread",
    name: "Rugbrød, Fiktivt Bageri",
    carbsPer100g: 40,
    verified: false,
    portions: [
      { label: "½ skive", carbs: 9 },
      { label: "1 skive", carbs: 18 },
      { label: "2 skiver", carbs: 36 },
    ],
  };
  it("asks with the stored name and reports the chosen portion's index", () => {
    const item = addFood(emptyDraft(), bread).items[0];
    if (!item) throw new Error("no item");
    const portion = vi.fn();
    mount(<PortionSheet item={item} onPortion={portion} onGrams={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "Hvor meget Rugbrød, Fiktivt Bageri?" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "2 skiver · 36 g" }));
    expect(portion).toHaveBeenCalledWith(2);
  });

  it("opens a grams field for Vej det and passes whole valid grams", () => {
    const item = addFood(emptyDraft(), bread).items[0];
    if (!item) throw new Error("no item");
    const grams = vi.fn();
    mount(<PortionSheet item={item} onPortion={vi.fn()} onGrams={grams} />);
    expect(screen.queryByRole("spinbutton")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Vej det" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Gram" }), {
      target: { value: "35" },
    });
    expect(grams).toHaveBeenLastCalledWith(35);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Gram" }), {
      target: { value: "" },
    });
    expect(grams).toHaveBeenLastCalledWith(null);
    fireEvent.change(screen.getByRole("spinbutton", { name: "Gram" }), {
      target: { value: "9000" },
    });
    expect(grams).toHaveBeenLastCalledWith(null);
  });
});

describe("BolusTap", () => {
  it("records only a time, shows Bolus HH:MM with an undo, and carries the drawn sentence", () => {
    const tap = vi.fn();
    const undo = vi.fn();
    const view = mount(
      <BolusTap bolusTs={null} timeZone="Europe/Copenhagen" onTap={tap} onUndo={undo} />,
    );
    expect(
      screen.getByText(
        '"Bolus givet nu" gemmer kun tidspunktet, så det kan ses på kurven. Frejsi regner aldrig insulin.',
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Bolus givet nu" }));
    expect(tap).toHaveBeenCalledWith();
    view.unmount();
    mount(
      <BolusTap
        bolusTs="2026-10-14T09:58:00.000Z"
        timeZone="Europe/Copenhagen"
        onTap={tap}
        onUndo={undo}
      />,
    );
    expect(screen.getByText("Bolus 11:58")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Fortryd" }));
    expect(undo).toHaveBeenCalledOnce();
    // No amount, unit or ratio can be entered anywhere.
    expect(document.querySelectorAll("input, select, textarea")).toHaveLength(0);
  });

  it("uses the allowed English label", () => {
    mount(<BolusTap bolusTs={null} timeZone="UTC" onTap={vi.fn()} onUndo={vi.fn()} />, "en");
    expect(screen.getByRole("button", { name: "bolus given now" })).toBeVisible();
  });
});

describe("TotalBar", () => {
  it("shows the running total in whole grams with the action", () => {
    const save = vi.fn();
    mount(<TotalBar total={50} actionLabel="Gem måltid" onAction={save} shortcut="⌘↩" />);
    expect(screen.getByTestId("total-bar")).toHaveTextContent("I alt50 g kulhydrat");
    fireEvent.click(screen.getByRole("button", { name: /Gem måltid/ }));
    expect(save).toHaveBeenCalledOnce();
  });
});

describe("ManualFoodForm", () => {
  it("creates a food from per-100 g or a portion, with the scanned barcode prefilled", () => {
    const create = vi.fn();
    mount(
      <ManualFoodForm
        initialName=""
        barcode="2000000000015"
        busy={false}
        failed={false}
        onCreate={create}
      />,
    );
    expect(screen.getByText("Stregkode 2000000000015")).toBeVisible();
    const submit = screen.getByRole("button", { name: "Opret og tilføj" });
    fireEvent.change(screen.getByLabelText("Navn"), { target: { value: "Fiktiv bar" } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Portion, fx 1 stk"), { target: { value: "1 stk" } });
    fireEvent.change(screen.getByLabelText("Kulhydrat i portionen"), { target: { value: "21" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(create).toHaveBeenCalledWith({
      name: "Fiktiv bar",
      portions: [{ label: "1 stk", carbs: 21 }],
      barcode: "2000000000015",
    });
  });
});

describe("BarcodeScanner", () => {
  beforeAll(() => {
    // jsdom has no media playback.
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  });
  const stream = () => {
    const stop = vi.fn();
    return { stop, stream: { getTracks: () => [{ stop }] } as unknown as MediaStream };
  };

  it("opens the rear camera, reads frames until a valid code and stops the camera first", async () => {
    const camera = stream();
    const getUserMedia = vi.fn(() => Promise.resolve(camera.stream));
    stubMedia({ getUserMedia });
    const detect = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("2000000000015");
    const detected = vi.fn();
    mount(
      <BarcodeScanner
        onDetected={detected}
        onClose={vi.fn()}
        onTypeBarcode={vi.fn()}
        onDenied={vi.fn()}
        createReader={() => Promise.resolve({ kind: "native", detect })}
        intervalMs={1}
      />,
    );
    await waitFor(() => {
      expect(detected).toHaveBeenCalledWith("2000000000015");
    });
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    expect(camera.stop).toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Scan en stregkode" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Luk" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Skriv stregkoden" })).toBeVisible();
  });

  it("uses a stubbed BarcodeDetector through the default reader", async () => {
    const camera = stream();
    stubMedia({ getUserMedia: () => Promise.resolve(camera.stream) });
    class FakeDetector {
      static getSupportedFormats = () => Promise.resolve(["ean_13", "ean_8", "upc_a"]);
      detect = () => Promise.resolve([{ rawValue: "20000004" }]);
    }
    vi.stubGlobal("BarcodeDetector", FakeDetector);
    const detected = vi.fn();
    mount(
      <BarcodeScanner
        onDetected={detected}
        onClose={vi.fn()}
        onTypeBarcode={vi.fn()}
        onDenied={vi.fn()}
        intervalMs={1}
      />,
    );
    await waitFor(() => {
      expect(detected).toHaveBeenCalledWith("20000004");
    });
  });

  it("reports a denied camera so the typed-barcode field can take over", async () => {
    stubMedia({
      getUserMedia: () => Promise.reject(new DOMException("denied", "NotAllowedError")),
    });
    const denied = vi.fn();
    mount(
      <BarcodeScanner
        onDetected={vi.fn()}
        onClose={vi.fn()}
        onTypeBarcode={vi.fn()}
        onDenied={denied}
      />,
    );
    await waitFor(() => {
      expect(denied).toHaveBeenCalledOnce();
    });
  });

  it("stops the camera when closed", async () => {
    const camera = stream();
    stubMedia({ getUserMedia: () => Promise.resolve(camera.stream) });
    const close = vi.fn();
    const view = mount(
      <BarcodeScanner
        onDetected={vi.fn()}
        onClose={close}
        onTypeBarcode={vi.fn()}
        onDenied={vi.fn()}
        createReader={() => Promise.resolve({ kind: "zxing", detect: () => Promise.resolve(null) })}
        intervalMs={5}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Luk" }));
    expect(close).toHaveBeenCalledOnce();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    view.unmount();
    expect(camera.stop).toHaveBeenCalled();
  });
});
