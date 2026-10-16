import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import da from "../../../messages/da";
import { fetchFake } from "../meal/test-support";
import { SayItSheet } from "./SayItSheet";

vi.mock("@/components/food/PhotoPicker", () => ({
  PhotoPicker: ({ onPhoto }: { onPhoto: (bytes: Uint8Array) => void }) => (
    <button
      onClick={() => {
        onPhoto(new Uint8Array([1, 2, 3]));
      }}
    >
      capture
    </button>
  ),
}));
const guessed = {
  query: "apple",
  estimate: { name: "Apple", carbs: 12, grams: 100, confidence: "low", approx: true },
};
const meal = { items: [guessed], unmatched: ["bread"] };
function mount() {
  const onAdd = vi.fn(() => Promise.resolve());
  const onSearch = vi.fn();
  render(
    <NextIntlClientProvider locale="da" messages={da}>
      <SayItSheet spaceId="s1" locale="da" onClose={vi.fn()} onAdd={onAdd} onSearch={onSearch} />
    </NextIntlClientProvider>,
  );
  return { onAdd, onSearch };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("does not send typing; sends on tap, edits estimates and opens search for unmatched", async () => {
  const fake = fetchFake().on("POST /api/spaces/s1/parse", meal);
  fake.install();
  const { onAdd, onSearch } = mount();
  expect(screen.queryByRole("button", { name: "Brug stemmen" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Skriv hvad der spises"), {
    target: { value: "apple and bread" },
  });
  expect(fake.calls).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Find maden" }));
  expect(await screen.findByText("Apple · ca. 12 g")).toBeInTheDocument();
  expect(screen.getByText("usikkert")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Kulhydrat (g)"), { target: { value: "15" } });
  fireEvent.click(screen.getByRole("button", { name: /Ikke fundet/ }));
  expect(onSearch).toHaveBeenCalledWith("bread");
  fireEvent.click(screen.getByRole("button", { name: "Tilføj til måltidet" }));
  await waitFor(() => {
    expect(onAdd).toHaveBeenCalledWith([
      { ...guessed, estimate: { ...guessed.estimate, carbs: 15 } },
    ]);
  });
  expect(fake.calls).toEqual([
    { method: "POST", path: "/api/spaces/s1/parse", body: { text: "apple and bread" } },
  ]);
});
it("speech fills the field and never submits on result or end, and stops on unmount", () => {
  const instances: SpeechFake[] = [];
  class SpeechFake {
    lang = "";
    onresult: ((event: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    start = vi.fn();
    stop = vi.fn();
    abort = vi.fn();
    constructor() {
      instances.push(this);
    }
  }
  vi.stubGlobal("SpeechRecognition", SpeechFake);
  const fake = fetchFake();
  fake.install();
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Brug stemmen" }));
  const recognition = instances[0];
  if (!recognition) throw new Error("Speech recognition was not constructed");
  expect(recognition.lang).toBe("da-DK");
  expect(screen.getByRole("button", { name: "Lytter …" })).toHaveAttribute("aria-pressed", "true");
  act(() => {
    recognition.onresult?.({ results: [[{ transcript: "apple" }]] });
    recognition.onend?.();
  });
  expect(screen.getByLabelText("Skriv hvad der spises")).toHaveValue("apple");
  expect(fake.calls).toEqual([]);
  cleanup();
  expect(recognition.abort).toHaveBeenCalled();
});
it("only sends a photo after capture and keeps text when AI is unavailable", async () => {
  const fake = fetchFake()
    .on("POST /api/spaces/s1/estimates", {
      items: [guessed.estimate],
      totalCarbs: 12,
      dishName: "Apple",
      approx: true,
    })
    .on("POST /api/spaces/s1/parse", { error: { code: "ai-cap-reached" } }, 429);
  fake.install();
  mount();
  expect(fake.calls).toEqual([]);
  fireEvent.click(screen.getByText("capture"));
  expect(await screen.findByText("Apple · ca. 12 g")).toBeInTheDocument();
  expect(fake.calls[0]).toEqual({
    method: "POST",
    path: "/api/spaces/s1/estimates",
    body: { photoDataUrl: "data:image/jpeg;base64,AQID" },
  });
  fireEvent.change(screen.getByLabelText("Skriv hvad der spises"), { target: { value: "apple" } });
  fireEvent.click(screen.getByRole("button", { name: "Find maden" }));
  expect(await screen.findByText("AI-hjælp er ikke tilgængelig lige nu")).toBeInTheDocument();
  expect(screen.getByLabelText("Skriv hvad der spises")).toHaveValue("apple");
});
it("invalidates parsed foods on a description edit, including after a failed retry", async () => {
  const fake = fetchFake().on("POST /api/spaces/s1/parse", meal);
  fake.install();
  const { onAdd } = mount();
  fireEvent.change(screen.getByLabelText("Skriv hvad der spises"), { target: { value: "apple" } });
  fireEvent.click(screen.getByRole("button", { name: "Find maden" }));
  await screen.findByText("Apple · ca. 12 g");
  fireEvent.change(screen.getByLabelText("Skriv hvad der spises"), { target: { value: "bread" } });
  expect(screen.queryByText("Apple · ca. 12 g")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Tilføj til måltidet" })).not.toBeInTheDocument();
  fake.on("POST /api/spaces/s1/parse", { error: { code: "ai-unavailable" } }, 503);
  fireEvent.click(screen.getByRole("button", { name: "Find maden" }));
  await screen.findByText("AI-hjælp er ikke tilgængelig lige nu");
  expect(screen.getByLabelText("Skriv hvad der spises")).toHaveValue("bread");
  expect(screen.queryByRole("button", { name: "Tilføj til måltidet" })).not.toBeInTheDocument();
  expect(onAdd).not.toHaveBeenCalled();
});
