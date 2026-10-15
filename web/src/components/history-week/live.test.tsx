import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, expect, it, vi } from "vitest";
import { getMessages } from "@/lib/i18n/messages";
import { fakeFetch, fakeSocketFactory, jsonResponse } from "@/lib/live/test-support";
import { HistoryWeekScreen } from "./HistoryWeekScreen";
import fixture from "./fixtures/week.json";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(cleanup);
it("the real event-only feed calls only week, negotiate and events, and refreshes a pushed meal", async () => {
  let percent = 81;
  const net = fakeFetch({
    "/history/week": () =>
      jsonResponse({
        ...fixture,
        now: "2025-10-08T12:00:00Z",
        numbers: { ...fixture.numbers, inRangePercent: percent },
      }),
    "/negotiate": () => jsonResponse({ url: "wss://fictional.example/hub" }),
    "/events": () => jsonResponse({ lastSeq: 20, events: [], more: false }),
  });
  const { sockets, factory } = fakeSocketFactory();
  render(
    <NextIntlClientProvider locale="en" messages={getMessages("en")}>
      <HistoryWeekScreen
        spaceId="s1"
        locale="en"
        unit="mgdl"
        start="2025-10-06"
        view="maaltider"
        fetch={net.fetch}
        socketFactory={factory}
      />
    </NextIntlClientProvider>,
  );
  await screen.findByText("81 %");
  expect(net.calls.findIndex((url) => url.includes("/events?"))).toBeLessThan(
    net.calls.findIndex((url) => url.includes("/history/week?")),
  );
  await waitFor(() => {
    expect(sockets).toHaveLength(1);
  });
  act(() => {
    sockets[0]?.open();
  });
  await waitFor(() => {
    expect(net.calls.some((url) => url.includes("/events?since=20"))).toBe(true);
  });
  expect(screen.getAllByRole("img", { name: /Peak 173 at 13:15/ })).toHaveLength(2);
  expect(screen.getByText("In range 72–180")).toBeVisible();
  percent = 79;
  act(() => {
    sockets[0]?.receive({
      seq: 21,
      spaceId: "s1",
      type: "meal.deleted",
      payload: { mealId: "meal-newer" },
      ts: "2025-10-08T12:01:00Z",
    });
  });
  await screen.findByText("79 %");
  expect(net.calls.filter((url) => url.includes("/history/week"))).toHaveLength(2);
  expect(
    [
      ...new Set(
        net.calls.map((url) =>
          new URL(url, "https://fictional.example").pathname.replace("/api/spaces/s1/", ""),
        ),
      ),
    ].sort(),
  ).toEqual(["events", "history/week", "negotiate"]);
});
