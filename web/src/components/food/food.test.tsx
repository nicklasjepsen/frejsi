import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import da from "../../../messages/da.json";
import en from "../../../messages/en.json";
import { CarbAmount, FoodPhoto, PhotoPicker, PhotoTile, PortionChips, SearchField } from "./index";

const mount = (children: ReactNode, locale = "da") =>
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "da" ? da : en}>
      {children}
    </NextIntlClientProvider>,
  );
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("food kit", () => {
  it("uses the thumbnail and replaces a failed image with the photo placeholder", () => {
    mount(<FoodPhoto src="https://photos.example.invalid/thumb.jpg" alt="Fictional food" />);
    const photo = screen.getByRole("img", { name: "Fictional food" });
    expect(photo).toHaveAttribute("src", "https://photos.example.invalid/thumb.jpg");
    fireEvent.error(photo);
    expect(screen.getByText("foto")).toBeVisible();
  });
  it.each([92, 104, 112, 140] as const)(
    "renders selected %i px tiles with the unverified mark",
    (size) => {
      mount(
        <PhotoTile title="Fictional bread" subtitle="18 g" verified={false} size={size} selected />,
      );
      expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button")).toHaveAttribute("data-size", String(size));
      expect(screen.getByText("Ikke tjekket")).toBeVisible();
      expect(screen.getByTestId("selection-check")).toBeVisible();
    },
  );
  it("formats carb amounts and per-100g amounts in both locales", () => {
    const first = mount(
      <>
        <CarbAmount amount={50} />
        <CarbAmount amount={40.5} per100g />
      </>,
    );
    expect(screen.getByText("50 g kulhydrat")).toBeVisible();
    expect(screen.getByText("40,5 g pr. 100 g")).toBeVisible();
    first.unmount();
    mount(<CarbAmount amount={40.5} per100g />, "en");
    expect(screen.getByText("40.5 g per 100 g")).toBeVisible();
  });
  it("selects first-class portions and hides weighing without a per-100g value", () => {
    const select = vi.fn();
    const props = {
      portions: [
        { label: "½ skive", carbs: 9 },
        { label: "1 skive", carbs: 18 },
        { label: "2 skiver", carbs: 36 },
      ],
      onSelect: select,
    };
    const view = mount(<PortionChips {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "1 skive · 18 g" }));
    expect(select).toHaveBeenCalledWith(props.portions[1]);
    expect(screen.queryByText("Vej det")).toBeNull();
    view.unmount();
    mount(<PortionChips {...props} carbsPer100g={40} desktop />);
    expect(screen.getByRole("button", { name: "Vej det" })).toBeVisible();
    expect(screen.getByRole("spinbutton", { name: "Gram" })).toBeInTheDocument();
  });
  it("submits search on Enter and renders a barcode icon plus keyboard hint", () => {
    const submit = vi.fn();
    mount(
      <SearchField
        label="Find food"
        value="fiction"
        onChange={vi.fn()}
        onSubmit={submit}
        icon="barcode"
        shortcut="/"
      />,
    );
    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
    expect(submit).toHaveBeenCalledWith("fiction");
    expect(screen.getByText("/").tagName).toBe("KBD");
    expect(screen.getByTestId("search-icon")).toHaveAttribute("data-icon", "barcode");
  });
  it("downsizing precedes the picker callback for capture and file input", async () => {
    const onPhoto = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: () => "blob:fictional",
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    Object.defineProperty(HTMLImageElement.prototype, "decode", {
      value: function (this: HTMLImageElement) {
        Object.defineProperty(this, "naturalWidth", { value: 2400 });
        Object.defineProperty(this, "naturalHeight", { value: 1800 });
        return Promise.resolve();
      },
      configurable: true,
    });
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: draw,
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
      this: HTMLCanvasElement,
      callback,
    ) {
      expect(this.width).toBe(1600);
      expect(draw).toHaveBeenCalled();
      callback(
        Object.assign(new Blob(["jpeg"], { type: "image/jpeg" }), {
          arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2]).buffer),
        }),
      );
    });
    mount(<PhotoPicker onPhoto={onPhoto} />);
    const capture = screen.getByLabelText("Tag et billede", { selector: "input" });
    expect(capture).toHaveAttribute("capture", "environment");
    for (const input of [
      capture,
      screen.getByLabelText("Vedhæft billede", { selector: "input" }),
    ]) {
      fireEvent.change(input, {
        target: { files: [new File(["input"], "fiction.png", { type: "image/png" })] },
      });
      await waitFor(() => {
        expect(onPhoto).toHaveBeenCalledWith(new Uint8Array([1, 2]));
      });
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Tag et billede" })).toBeEnabled(),
      );
    }
    expect(onPhoto).toHaveBeenCalledTimes(2);
  });
  it("keeps unreadable files local and shows a translated error", async () => {
    const onPhoto = vi.fn();
    mount(<PhotoPicker onPhoto={onPhoto} />);
    fireEvent.change(screen.getByLabelText("Vedhæft billede", { selector: "input" }), {
      target: { files: [new File(["%PDF"], "fiction.pdf", { type: "application/pdf" })] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Billedet kunne ikke læses");
    expect(onPhoto).not.toHaveBeenCalled();
  });
});
