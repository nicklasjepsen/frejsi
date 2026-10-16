import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import { EstimateView } from "./EstimateView";
import { AskFlow } from "./AskFlow";
import { clearPendingEstimate } from "./pending";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
const estimate = {
  dishName: "Example plate",
  approx: true as const,
  totalCarbs: 12,
  items: [{ name: "Example pear", carbs: 12, confidence: "low" as const, approx: true as const }],
};
const wrap = (child: React.ReactNode) =>
  render(
    <I18nProvider locale="en" messages={getMessages("en")}>
      {child}
    </I18nProvider>,
  );
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.push.mockClear();
  clearPendingEstimate();
});
it("renders only back and ask controls, approximate items, low confidence and the review notice", () => {
  wrap(
    <EstimateView
      estimate={estimate}
      photoDataUrl="data:image/jpeg;base64,YWJj"
      carers={["Rowan", "Sky"]}
      locale="en"
      simple
      onBack={() => undefined}
      onAsk={() => undefined}
    />,
  );
  expect(screen.getByText("A guess · not checked")).toBeVisible();
  expect(screen.getByText("approx. 12 g · uncertain")).toBeVisible();
  expect(
    screen.getByText("This is a guess. An adult needs to look at it before you use the number."),
  ).toBeVisible();
  expect(screen.getByText("Rowan and Sky will be notified straight away")).toBeVisible();
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["←", "Ask an adult"]);
  expect(screen.queryByRole("spinbutton")).toBeNull();
});
it.each([true, false])(
  "direct ask shows one capture button at the correct size (simple=%s), without a POST",
  async (simple) => {
    const fetcher = vi.fn(() =>
      Promise.resolve(Response.json({ available: true, carers: ["Rowan"] })),
    );
    vi.stubGlobal("fetch", fetcher);
    wrap(<AskFlow spaceId="s1" locale="en" simple={simple} />);
    const button = await screen.findByRole("button", { name: "Take a photo" });
    expect(button).toHaveAttribute("data-size", simple ? "simple" : "desktop");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(fetcher.mock.calls).toHaveLength(1);
  },
);
it("off/cap/unavailable has no capture and names the carers", async () => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(Response.json({ available: false, carers: ["Rowan"] })),
  );
  wrap(<AskFlow spaceId="s1" locale="en" simple />);
  expect(await screen.findByText("Ask Rowan – they can help you")).toBeVisible();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByLabelText("Take a photo")).toBeNull();
});

it("asks once, announces success and returns to Now without a meal POST", async () => {
  const { setPendingEstimate } = await import("./pending");
  setPendingEstimate({ spaceId: "s1", estimate, photoDataUrl: "data:image/jpeg;base64,YWJj" });
  const writes: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      writes.push({ url, body: JSON.parse(typeof init.body === "string" ? init.body : "null") });
      return Promise.resolve(Response.json({ foodId: "f1" }));
    }
    return Promise.resolve(Response.json({ available: false, carers: ["Rowan"] }));
  });
  wrap(<AskFlow spaceId="s1" locale="en" simple />);
  await screen.findByText("Rowan will be notified straight away");
  fireEvent.click(screen.getByRole("button", { name: "Ask an adult" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Sent to Rowan");
  expect(writes).toEqual([
    {
      url: "/api/spaces/s1/estimates/ask",
      body: { estimate, photoDataUrl: "data:image/jpeg;base64,YWJj" },
    },
  ]);
  await waitFor(
    () => {
      expect(nav.push).toHaveBeenCalledWith("/en/now");
    },
    { timeout: 2200 },
  );
});
it("keeps a failed ask available for retry and does not navigate", async () => {
  const { setPendingEstimate } = await import("./pending");
  setPendingEstimate({ spaceId: "s1", estimate, photoDataUrl: "data:image/jpeg;base64,YWJj" });
  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) =>
    Promise.resolve(
      init?.method === "POST"
        ? Response.json(
            { error: { code: "photo-unavailable", message: "photo-unavailable" } },
            { status: 503 },
          )
        : Response.json({ available: true, carers: ["Rowan"] }),
    ),
  );
  wrap(<AskFlow spaceId="s1" locale="en" simple />);
  fireEvent.click(screen.getByRole("button", { name: "Ask an adult" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("It could not be saved");
  expect(screen.getByRole("button", { name: "Ask an adult" })).toBeEnabled();
  expect(nav.push).not.toHaveBeenCalled();
});
