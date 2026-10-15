import "@testing-library/jest-dom/vitest";

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { DayView } from "@frejsi/shared/schemas/meal";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventsPage } from "@/lib/live/contracts";
import {
  fakeFetch,
  fakeSocketFactory,
  jsonResponse,
  type FakeSocket,
} from "@/lib/live/test-support";

import da from "../../../../../messages/da";
import en from "../../../../../messages/en";

import { RECHECK_MS, TodayScreen } from "./TodayScreen";

const T0 = new Date("2026-10-14T11:13:00.000Z"); // Wednesday 13:13 in Copenhagen
const ZONE = "Europe/Copenhagen";

const meal = (id: string, ts: string, title: string, carbs: number, by: string) => ({
  id,
  ts,
  title,
  slot: "lunch" as const,
  totalCarbs: carbs,
  byUser: { id: `u-${by}`, name: by },
  items: [{ name: title, carbs }],
});

const fullDay: DayView = {
  date: "2026-10-14",
  timezone: ZONE,
  totalCarbs: 102,
  mealCount: 3,
  lastMealAt: "2026-10-14T10:10:00.000Z",
  meals: [
    meal("m3", "2026-10-14T10:10:00.000Z", "Rugbrød med ost og et æble", 50, "Jonas"),
    meal("m2", "2026-10-14T07:50:00.000Z", "Æble", 14, "Alma"),
    meal("m1", "2026-10-14T05:15:00.000Z", "Havregrød med æble", 38, "Mette"),
  ],
};
const emptyDay: DayView = {
  date: "2026-10-14",
  timezone: ZONE,
  totalCarbs: 0,
  mealCount: 0,
  meals: [],
};

const people = {
  members: [
    {
      userId: "u-Jonas",
      name: "Jonas",
      role: "owner",
      simpleMode: false,
      lastSeen: null,
      devices: [],
    },
    {
      userId: "u-Mette",
      name: "Mette",
      role: "owner",
      simpleMode: false,
      lastSeen: null,
      devices: [],
    },
    {
      userId: "u-Alma",
      name: "Alma",
      role: "carer",
      simpleMode: true,
      lastSeen: null,
      devices: [],
    },
    {
      userId: "u-L",
      name: "Lærke",
      role: "viewer",
      simpleMode: false,
      lastSeen: null,
      devices: [],
    },
  ],
  invites: [],
};

let server: { day: DayView; dayStatus: number; lastSeq: number; members: unknown };
let net: ReturnType<typeof fakeFetch>;
let sockets: FakeSocket[];
let factory: ReturnType<typeof fakeSocketFactory>["factory"];

beforeEach(() => {
  vi.useFakeTimers({
    now: T0,
    toFake: ["setTimeout", "setInterval", "clearInterval", "clearTimeout", "Date"],
  });
  server = { day: fullDay, dayStatus: 200, lastSeq: 20, members: people };
  net = fakeFetch({
    "/day": () =>
      server.dayStatus === 200
        ? jsonResponse(server.day)
        : jsonResponse({ error: { code: "internal", message: "" } }, server.dayStatus),
    "/members": () => jsonResponse(server.members),
    "/negotiate": () => jsonResponse({ url: "wss://example/hub" }),
    "/events": () =>
      jsonResponse({ lastSeq: server.lastSeq, events: [], more: false } satisfies EventsPage),
  });
  ({ sockets, factory } = fakeSocketFactory());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));

async function mount(locale: "da" | "en" = "da") {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "da" ? da : en}>
      <TodayScreen spaceId="s1" locale={locale} fetch={net.fetch} socketFactory={factory} />
    </NextIntlClientProvider>,
  );
  await flush();
  act(() => sockets[0]?.open());
  await flush();
}

const dayCalls = () => net.calls.filter((c) => c.endsWith("/day")).length;

describe("I dag (Historik-Viewer)", () => {
  it("draws the date, the 72 px total, the summary, the rows and the notice with the owners", async () => {
    await mount();
    const page = screen.getByTestId("today");
    expect(within(page).getByRole("heading", { level: 1 })).toHaveTextContent(
      "I dag, onsdag 14. oktober",
    );
    expect(screen.getByTestId("day-total")).toHaveTextContent("102g kulhydrat indtil nu");
    expect(screen.getByTestId("day-summary")).toHaveTextContent("3 måltider · sidst kl. 12:10");
    const rows = within(screen.getByTestId("day-list")).getAllByTestId("meal-card");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("12:10"),
      expect.stringContaining("09:50"),
      expect.stringContaining("07:15"),
    ]);
    expect(rows[0]).toHaveTextContent("50 g kulhydrat · Jonas");
    expect(rows[0]).toHaveAttribute("data-variant", "row");
    expect(screen.getByTestId("today-notice")).toHaveTextContent(
      "Som »ser med« kan du se dagens måltider og kulhydrater. Blodsukker vises ikke her – spørg Jonas eller Mette, hvis du er i tvivl.",
    );
  });

  it("says one meal in the singular", async () => {
    server.day = { ...fullDay, totalCarbs: 50, mealCount: 1, meals: fullDay.meals.slice(0, 1) };
    await mount();
    expect(screen.getByTestId("day-summary")).toHaveTextContent("1 måltid · sidst kl. 12:10");
  });

  it("reads 'Ingen måltider i dag endnu' on an empty day", async () => {
    server.day = emptyDay;
    await mount();
    expect(screen.getByText("Ingen måltider i dag endnu")).toBeVisible();
    expect(screen.getByTestId("day-total")).toHaveTextContent("0g kulhydrat indtil nu");
    expect(screen.queryByTestId("day-summary")).toBeNull();
  });

  it("calls no route but day, members, negotiate and events, and never asks for readings", async () => {
    await mount();
    expect(net.calls.length).toBeGreaterThan(3);
    for (const call of net.calls) {
      expect(call).toMatch(/^\/api\/spaces\/s1\/(day|members|negotiate|events\?since=\d+)$/);
    }
    expect(net.calls.some((c) => c.includes("readings"))).toBe(false);
  });

  it("mounts no glucose component and draws no glucose", async () => {
    await mount();
    expect(screen.queryByTestId("glucose-number")).toBeNull();
    expect(screen.queryByTestId("glucose-age")).toBeNull();
    expect(document.body.textContent).not.toMatch(/mmol|mg\/dL/i);
    // Nothing on this screen can reach a glucose component: not the page, not the day kit.
    const web = path.resolve(import.meta.dirname, "../../../../..");
    const files = [
      ...["src/app/[locale]/(app)/today", "src/components/day"].flatMap((dir) =>
        readdirSync(path.join(web, dir))
          .map((f) => path.join(web, dir, f))
          .filter((f) => statSync(f).isFile() && /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)),
      ),
    ];
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/components\/glucose|GlucoseValue|GlucoseChart|\/readings/);
    }
  });

  it.each(["meal.created", "meal.updated", "meal.deleted"] as const)(
    "fetches the day again on %s",
    async (type) => {
      await mount();
      const before = dayCalls();
      server.day = emptyDay;
      act(() =>
        sockets[0]?.receive({
          spaceId: "s1",
          seq: 21,
          ts: T0.toISOString(),
          type,
          payload:
            type === "meal.created"
              ? { mealId: "m9", ts: T0.toISOString(), totalCarbs: 12 }
              : { mealId: "m3" },
        }),
      );
      await flush();
      expect(dayCalls()).toBe(before + 1);
      expect(screen.getByText("Ingen måltider i dag endnu")).toBeVisible();
    },
  );

  it("does not fetch the day for other events, and fetches it again on window focus", async () => {
    await mount();
    const before = dayCalls();
    act(() =>
      sockets[0]?.receive({
        spaceId: "s1",
        seq: 21,
        ts: T0.toISOString(),
        type: "food.updated",
        payload: { foodId: "f1" },
      }),
    );
    await flush();
    expect(dayCalls()).toBe(before);
    act(() => {
      fireEvent.focus(window);
    });
    await flush();
    expect(dayCalls()).toBe(before + 1);
  });

  it("fetches the day again on space.updated, since the timezone may have changed", async () => {
    await mount();
    const before = dayCalls();
    act(() =>
      sockets[0]?.receive({
        spaceId: "s1",
        seq: 21,
        ts: T0.toISOString(),
        type: "space.updated",
        payload: { fields: ["timezone"] },
      }),
    );
    await flush();
    expect(dayCalls()).toBe(before + 1);
  });

  it("retries a failed read every 30 seconds until it succeeds", async () => {
    server.dayStatus = 500;
    await mount();
    expect(screen.getByRole("alert")).toBeVisible();
    const before = dayCalls();
    server.dayStatus = 200;
    await act(() => vi.advanceTimersByTimeAsync(RECHECK_MS));
    expect(dayCalls()).toBe(before + 1);
    expect(screen.getByTestId("day-total")).toHaveTextContent("102");
    await act(() => vi.advanceTimersByTimeAsync(RECHECK_MS * 3));
    expect(dayCalls()).toBe(before + 1);
  });

  it("fetches the new day when the space's midnight passes", async () => {
    await mount();
    const before = dayCalls();
    // 23:59:50 in Copenhagen; the next check falls after midnight.
    vi.setSystemTime(new Date("2026-10-14T21:59:50.000Z"));
    server.day = { ...emptyDay, date: "2026-10-15" };
    await act(() => vi.advanceTimersByTimeAsync(RECHECK_MS));
    expect(dayCalls()).toBe(before + 1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "I dag, torsdag 15. oktober",
    );
    await act(() => vi.advanceTimersByTimeAsync(RECHECK_MS * 2));
    expect(dayCalls()).toBe(before + 1);
  });

  it("keeps the day on screen when a refresh fails, and says so when the first read fails", async () => {
    await mount();
    server.dayStatus = 500;
    act(() => {
      fireEvent.focus(window);
    });
    await flush();
    expect(screen.getByTestId("day-total")).toHaveTextContent("102");
    cleanup();
    await mount();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Dagens måltider kunne ikke hentes lige nu.",
    );
    expect(screen.queryByTestId("day-total")).toBeNull();
  });

  it("leaves the names out of the notice when the members cannot be read", async () => {
    server.members = { nope: true };
    await mount();
    expect(screen.getByTestId("today-notice")).toHaveTextContent(
      "Som »ser med« kan du se dagens måltider og kulhydrater. Blodsukker vises ikke her.",
    );
  });

  it("speaks English", async () => {
    await mount("en");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Today, Wednesday 14 October",
    );
    expect(screen.getByTestId("day-summary")).toHaveTextContent("3 meals · last at 12:10");
    expect(screen.getByTestId("today-notice")).toHaveTextContent("ask Jonas or Mette");
  });
});
