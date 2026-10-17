import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";
import { fetchFake } from "../meal/test-support";
import { SymptomPicker, type SymptomPickerProps } from "./SymptomPicker";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push, replace: vi.fn(), prefetch: vi.fn() }),
}));
const feed = vi.hoisted(() => ({
  handlers: new Map<string, (() => void)[]>(),
  subscribe: (type: string, handler: () => void) => {
    feed.handlers.set(type, [...(feed.handlers.get(type) ?? []), handler]);
    return () => undefined;
  },
  fire: (type: string) => {
    for (const handler of feed.handlers.get(type) ?? []) handler();
  },
}));
vi.mock("@/lib/live/useLiveFeed", () => ({
  useLiveFeed: () => ({ subscribe: feed.subscribe, loaded: true }),
}));

const now = new Date("2026-10-15T13:00:00.000Z"); // 15:00 in Copenhagen
const custom = [{ id: "custom:itchy", label: { da: "Kløe", en: "Itchy" } }];
const entry = (id: string, kind: string, ts = now.toISOString(), byName = "Jonas") => ({
  id,
  kind,
  ts,
  byUserId: "u1",
  byName,
});
let logged: ReturnType<typeof entry>[];
let fake: ReturnType<typeof fetchFake>;
beforeEach(() => {
  navigation.push.mockClear();
  feed.handlers.clear();
  logged = [];
  fake = fetchFake()
    .on("GET /api/spaces/s1/symptoms/kinds", { kinds: custom })
    .on("GET /api/spaces/s1/symptoms", () => ({ symptoms: logged }))
    .on("POST /api/spaces/s1/symptoms", (call: { body: unknown }) => {
      const body = call.body as { kind: string; ts?: string };
      const saved = entry("y1", body.kind, body.ts ?? now.toISOString());
      logged = [...logged, saved];
      return saved;
    })
    .on("DELETE /api/spaces/s1/symptoms/y1", null, 204);
  fake.install();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const base: SymptomPickerProps = {
  spaceId: "s1",
  locale: "da",
  simple: false,
  timeZone: "Europe/Copenhagen",
  now: () => now,
};
function mount(props: Partial<SymptomPickerProps> = {}, locale: AppLocale = "da") {
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <SymptomPicker {...base} {...props} locale={locale} />
    </I18nProvider>,
  );
}
const tiles = async () =>
  within(await screen.findByTestId("feel-grid"))
    .getAllByRole("button")
    .map((b) => b.textContent);

describe("Jeg har det… (the picker, plan §5)", () => {
  it("shows the six tiles with pictures and names, then the space's own kinds with their label", async () => {
    mount();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Jeg har det…");
    expect(await tiles()).toEqual([
      "Ondt i maven",
      "Svimmel",
      "Kvalme",
      "Træt",
      "Hovedpine",
      "Rysten",
      "Kløe",
    ]);
    const grid = screen.getByTestId("feel-grid");
    expect(grid.querySelectorAll("svg[data-kind]")).toHaveLength(7);
    expect(grid.querySelector('svg[data-kind="custom"]')).not.toBeNull();
    expect(fake.calls.map((c) => c.path).sort()).toEqual([
      "/api/spaces/s1/symptoms/kinds",
      expect.stringMatching(/^\/api\/spaces\/s1\/symptoms\?from=.*&to=/),
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Luk" }));
    expect(navigation.push).toHaveBeenCalledWith("/da/now");
  });
  it("renders the custom kind in English for an English session", async () => {
    mount({}, "en");
    expect(await tiles()).toContain("Itchy");
  });
  it("logs the kind at now with one tap, says Logget with Fortryd, and Fortryd deletes it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    fireEvent.click((await screen.findAllByRole("button", { name: "Ondt i maven" }))[0] as Element);
    const status = await screen.findByTestId("feel-status");
    expect(status).toHaveTextContent("Ondt i maven er logget");
    expect(fake.calls.find((c) => c.method === "POST")).toEqual({
      method: "POST",
      path: "/api/spaces/s1/symptoms",
      body: { kind: "stomach-ache" },
    });
    await waitFor(() => {
      expect(screen.getByTestId("feel-today")).toHaveTextContent("Ondt i maven kl. 15:00 · Jonas");
    });
    fireEvent.click(within(status).getByRole("button", { name: "Fortryd" }));
    await waitFor(() => {
      expect(fake.calls.at(-2)).toMatchObject({ method: "DELETE", path: "/api/spaces/s1/symptoms/y1" });
    });
    expect(await screen.findByText("Fortrudt")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByTestId("feel-status")).not.toBeInTheDocument();
  });
  it("hides the status after ten seconds when nothing is undone", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mount();
    fireEvent.click((await screen.findAllByRole("button", { name: "Svimmel" }))[0] as Element);
    await screen.findByTestId("feel-status");
    act(() => {
      vi.advanceTimersByTime(9_000);
    });
    expect(screen.getByTestId("feel-status")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(screen.queryByTestId("feel-status")).not.toBeInTheDocument();
  });
  it("in simpleMode shows tiles only, no Mere…, no sheet, and sends the kind alone", async () => {
    mount({ simple: true });
    expect(await tiles()).toHaveLength(7);
    expect(screen.getByTestId("feel")).toHaveAttribute("data-simple", "true");
    expect(screen.queryByRole("button", { name: "Mere…" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("feel-when")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Træt" }));
    const status = await screen.findByTestId("feel-status");
    expect(fake.calls.find((c) => c.method === "POST")?.body).toEqual({ kind: "tired" });
    expect(screen.queryByTestId("symptom-sheet")).not.toBeInTheDocument();
    // The route refuses a simpleMode delete, so the child is not offered one.
    expect(within(status).queryByRole("button", { name: "Fortryd" })).not.toBeInTheDocument();
  });
  it("asks for today's entries by the space's calendar day, not the last 24 hours", async () => {
    mount();
    await tiles();
    const list = fake.calls.find((c) => c.path.startsWith("/api/spaces/s1/symptoms?"));
    const query = new URL(`https://x${list?.path ?? ""}`).searchParams;
    // 15 October in Copenhagen (CEST): 22:00Z the day before to 22:00Z that day.
    expect(query.get("from")).toBe("2026-10-14T22:00:00.000Z");
    expect(query.get("to")).toBe("2026-10-15T22:00:00.000Z");
  });
  it("Mere… opens the sheet with severity chips, a note and a time, and saves them with the kind", async () => {
    mount();
    await tiles();
    fireEvent.click(screen.getByRole("button", { name: "Mere…" }));
    const sheet = screen.getByTestId("symptom-sheet");
    expect(screen.queryByTestId("feel-grid")).not.toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("radio", { name: "Kvalme" }));
    fireEvent.click(within(sheet).getByRole("radio", { name: "En del" }));
    fireEvent.change(within(sheet).getByLabelText("Note"), { target: { value: "Efter frokost" } });
    expect(within(sheet).getByLabelText("Hvilken dag?")).toHaveValue("2026-10-15");
    expect(within(sheet).getByLabelText("Klokken")).toHaveValue("15:00");
    fireEvent.change(within(sheet).getByLabelText("Klokken"), { target: { value: "14:20" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Log det" }));
    await screen.findByTestId("feel-status");
    expect(fake.calls.find((c) => c.method === "POST")?.body).toEqual({
      kind: "nausea",
      ts: "2026-10-15T12:20:00.000Z",
      severity: "medium",
      note: "Efter frokost",
    });
    expect(screen.queryByTestId("symptom-sheet")).not.toBeInTheDocument();
    expect(screen.getByTestId("feel-grid")).toBeInTheDocument();
    expect(screen.getByTestId("feel-status")).toHaveTextContent("Kvalme er logget kl. 14:20");
  });
  it("Hvornår? starts at Nu, and a tile logs at the chosen time ago and says when", async () => {
    mount();
    await tiles();
    const when = within(screen.getByTestId("feel-when"));
    expect(when.getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Nu",
      "15 min siden",
      "30 min siden",
      "1 time siden",
      "2 timer siden",
    ]);
    expect(when.getByRole("radio", { name: "Nu" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(when.getByRole("radio", { name: "30 min siden" }));
    fireEvent.click(screen.getByRole("button", { name: "Hovedpine" }));
    expect(await screen.findByTestId("feel-status")).toHaveTextContent("Hovedpine er logget kl. 14:30");
    expect(fake.calls.find((c) => c.method === "POST")?.body).toEqual({
      kind: "headache",
      ts: "2026-10-15T12:30:00.000Z",
    });
  });
  it("Mere… opens the sheet at the time chosen in Hvornår?", async () => {
    mount();
    await tiles();
    fireEvent.click(within(screen.getByTestId("feel-when")).getByRole("radio", { name: "2 timer siden" }));
    fireEvent.click(screen.getByRole("button", { name: "Mere…" }));
    const sheet = screen.getByTestId("symptom-sheet");
    expect(within(sheet).getByLabelText("Hvilken dag?")).toHaveValue("2026-10-15");
    expect(within(sheet).getByLabelText("Klokken")).toHaveValue("13:00");
  });
  it("the sheet logs on another day of the last week and says which", async () => {
    mount();
    await tiles();
    fireEvent.click(screen.getByRole("button", { name: "Mere…" }));
    const sheet = screen.getByTestId("symptom-sheet");
    const day = within(sheet).getByLabelText("Hvilken dag?");
    const options = within(day).getAllByRole("option");
    expect(options).toHaveLength(7);
    expect(options.slice(0, 2).map((o) => o.textContent)).toEqual(["I dag", "I går"]);
    expect(options[2]?.textContent).toMatch(/^tirsdag (den )?13\. oktober$/);
    fireEvent.change(day, { target: { value: "2026-10-14" } });
    fireEvent.change(within(sheet).getByLabelText("Klokken"), { target: { value: "22:15" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Log det" }));
    expect(await screen.findByTestId("feel-status")).toHaveTextContent("Ondt i maven er logget i går kl. 22:15");
    expect(fake.calls.find((c) => c.method === "POST")?.body).toEqual({
      kind: "stomach-ache",
      ts: "2026-10-14T20:15:00.000Z",
    });
  });
  it("names the date when the sheet logs further back than yesterday", async () => {
    mount();
    await tiles();
    fireEvent.click(screen.getByRole("button", { name: "Mere…" }));
    const sheet = screen.getByTestId("symptom-sheet");
    fireEvent.change(within(sheet).getByLabelText("Hvilken dag?"), { target: { value: "2026-10-12" } });
    fireEvent.change(within(sheet).getByLabelText("Klokken"), { target: { value: "09:00" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Log det" }));
    expect(await screen.findByTestId("feel-status")).toHaveTextContent(
      /^Ondt i maven er logget mandag (den )?12\. oktober kl\. 09:00/,
    );
  });
  it("refuses a time that has not come yet, and says so", async () => {
    mount();
    await tiles();
    fireEvent.click(screen.getByRole("button", { name: "Mere…" }));
    const sheet = screen.getByTestId("symptom-sheet");
    fireEvent.change(within(sheet).getByLabelText("Klokken"), { target: { value: "15:30" } });
    expect(within(sheet).getByTestId("symptom-ahead")).toHaveTextContent("Det tidspunkt er ikke kommet endnu");
    expect(within(sheet).getByRole("button", { name: "Log det" })).toBeDisabled();
    fireEvent.change(within(sheet).getByLabelText("Hvilken dag?"), { target: { value: "2026-10-14" } });
    expect(within(sheet).queryByTestId("symptom-ahead")).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Log det" })).toBeEnabled();
  });
  it("reloads today's list when the feed says a symptom was created elsewhere", async () => {
    mount();
    await tiles();
    expect(await screen.findByText("Intet logget i dag")).toBeInTheDocument();
    logged = [entry("y9", "headache", "2026-10-15T10:05:00.000Z", "Alma")];
    act(() => {
      feed.fire("symptom.created");
    });
    await waitFor(() => {
      expect(screen.getByTestId("feel-today")).toHaveTextContent("Hovedpine kl. 12:05 · Alma");
    });
  });
  it("fetches today's list once when mounted without a clock, as the page mounts it", async () => {
    const { now: _now, ...withoutClock } = base;
    render(
      <I18nProvider locale="da" messages={getMessages("da")}>
        <SymptomPicker {...withoutClock} />
      </I18nProvider>,
    );
    await tiles();
    await screen.findByText("Intet logget i dag");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fake.calls.filter((c) => c.path.startsWith("/api/spaces/s1/symptoms?"))).toHaveLength(1);
  });
  it("says it could not be saved and keeps the tiles when the route refuses", async () => {
    fake.on("POST /api/spaces/s1/symptoms", { error: { code: "symptom-kind-unknown" } }, 400);
    mount();
    fireEvent.click((await screen.findAllByRole("button", { name: "Rysten" }))[0] as Element);
    expect(await screen.findByRole("alert")).toHaveTextContent("Det blev ikke gemt – prøv igen");
    expect(screen.queryByTestId("feel-status")).not.toBeInTheDocument();
    expect(await tiles()).toHaveLength(7);
  });
});
