import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import { food } from "./test-support";
import { AskFlow } from "@/components/estimate/AskFlow";
import { SimplePicker } from "./SimplePicker";
import { getPendingEstimate, clearPendingEstimate } from "@/components/estimate/pending";
const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("@/lib/photos/downscale", () => ({
  downscale: () =>
    Promise.resolve({
      arrayBuffer: () => Promise.resolve(new Uint8Array([255, 216, 255, 1]).buffer),
    }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  nav.push.mockClear();
  clearPendingEstimate();
});
it("capture alone posts the downscaled JPEG, then opens ask with an in-memory result", async () => {
  const posts: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(typeof init.body === "string" ? init.body : "null"));
        return Promise.resolve(
          Response.json({
            dishName: "Example",
            approx: true,
            totalCarbs: 12,
            items: [{ name: "Pear", grams: 100, carbs: 12, confidence: "low", approx: true }],
          }),
        );
      }
      return Promise.resolve(
        Response.json(
          _url.endsWith("estimates") ? { available: true, carers: ["Rowan"] } : { foods: [] },
        ),
      );
    }),
  );
  render(
    <I18nProvider locale="en" messages={getMessages("en")}>
      <SimplePicker spaceId="s1" locale="en" simple />
    </I18nProvider>,
  );
  const tile = await screen.findByRole("button", { name: "Something else? Take a photo" });
  expect(posts).toEqual([]);
  fireEvent.click(tile);
  expect(posts).toEqual([]);
  fireEvent.change(screen.getByLabelText("Take a photo", { selector: "input" }), {
    target: { files: [new File(["photo"], "example.jpg", { type: "image/jpeg" })] },
  });
  await waitFor(() => {
    expect(nav.push).toHaveBeenCalledWith("/en/ask");
  });
  expect(posts).toEqual([{ photoDataUrl: "data:image/jpeg;base64,/9j/AQ==" }]);
  expect(getPendingEstimate("s1")).toMatchObject({ estimate: { approx: true, totalCarbs: 12 } });
});
it("search submits remote=true on Enter and keeps only verified library results", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", (url: string) => {
    urls.push(url);
    if (url.includes("lookup"))
      return Promise.resolve(
        Response.json({
          results: [
            { source: "library", verified: true, food: food("good", "Checked pear") },
            {
              source: "library",
              verified: false,
              food: food("bad", "Unchecked pear", { verified: false }),
            },
            {
              source: "cache",
              verified: false,
              food: food("cache", "Cached pear", { verified: false }),
            },
          ],
          sources: {},
          manual: {},
        }),
      );
    return Promise.resolve(
      Response.json(url.endsWith("estimates") ? { available: false, carers: [] } : { foods: [] }),
    );
  });
  render(
    <I18nProvider locale="en" messages={getMessages("en")}>
      <SimplePicker spaceId="s1" locale="en" simple />
    </I18nProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Find something else" }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "pear" } });
  expect(urls.some((url) => url.includes("lookup"))).toBe(false);
  fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Enter" });
  await waitFor(() => {
    expect(urls.some((url) => url.includes("remote=true"))).toBe(true);
  });
  expect(await screen.findByRole("button", { name: /Checked pear/ })).toBeVisible();
  expect(screen.queryByText("Unchecked pear")).toBeNull();
  expect(screen.queryByText("Cached pear")).toBeNull();
  expect(screen.queryByRole("button", { name: /Something else/ })).toBeNull();
});

it("a capped capture hides the camera and shows the named-carer fallback", async () => {
  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) =>
    Promise.resolve(
      init?.method === "POST"
        ? Response.json(
            { error: { code: "ai-cap-reached", message: "ai-cap-reached" } },
            { status: 429 },
          )
        : Response.json({ available: true, carers: ["Rowan"] }),
    ),
  );
  render(
    <I18nProvider locale="en" messages={getMessages("en")}>
      <AskFlow spaceId="s1" locale="en" simple />
    </I18nProvider>,
  );
  await screen.findByRole("button", { name: "Take a photo" });
  fireEvent.change(screen.getByLabelText("Take a photo", { selector: "input" }), {
    target: { files: [new File(["photo"], "example.jpg", { type: "image/jpeg" })] },
  });
  expect(await screen.findByText("Ask Rowan – they can help you")).toBeVisible();
  expect(screen.queryByRole("button")).toBeNull();
  expect(nav.push).not.toHaveBeenCalled();
});
