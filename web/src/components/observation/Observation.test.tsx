import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import { Observation } from "./Observation";
import { WeekObservation } from "./WeekObservation";
afterEach(cleanup);
const wrap = (child: React.ReactNode) => (
  <I18nProvider locale="en" messages={getMessages("en")}>
    {child}
  </I18nProvider>
);
it("shows a completed sentence and hides unavailable states", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ state: "ready", text: "The peak followed the meal." }));
  const view = render(
    wrap(<Observation spaceId="fictional" mealId="meal" complete fetch={fetcher} />),
  );
  expect(await screen.findByText("The peak followed the meal.")).toBeVisible();
  expect(screen.getByText("Observation · AI")).toBeVisible();
  expect(fetcher.mock.calls[0]?.[0]).toBe("/api/spaces/fictional/meals/meal/insight");
  view.unmount();
  render(
    wrap(
      <Observation
        spaceId="fictional"
        mealId="meal"
        complete
        fetch={vi.fn<typeof fetch>().mockResolvedValue(Response.json({ state: "cap" }))}
      />,
    ),
  );
  await waitFor(() => {
    expect(screen.queryByText("Observation · AI")).toBeNull();
  });
});
it("edits and copies the stored numbered weekly questions", async () => {
  const question = "What patterns appeared after lunch?";
  const edited = "What patterns appeared after dinner?";
  let current = question;
  const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
    if (init?.method === "PATCH") current = edited;
    return Promise.resolve(
      Response.json({
        state: "ready",
        summary: "Recorded meals appear through the week.",
        questions: [current],
        questionsEdited: init?.method === "PATCH",
        rejectedCount: 0,
      }),
    );
  });
  const clipboard = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
  render(wrap(<WeekObservation spaceId="fictional" start="2026-10-12" fetch={fetcher} />));
  expect(await screen.findByText(question)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Edit questions" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: edited } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("Saved")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() => {
    expect(clipboard).toHaveBeenCalledWith(`1. ${edited}`);
  });
  expect(
    fetcher.mock.calls.every(([url]) =>
      (typeof url === "string" ? url : url instanceof URL ? url.href : url.url).includes(
        "history/week/insight",
      ),
    ),
  ).toBe(true);
});
it("shows pending copy, refreshes this meal on insight.created, and suppresses off", async () => {
  const { EventEnvelope } = await import("@frejsi/shared/schemas/events");
  type Subscriber = NonNullable<React.ComponentProps<typeof Observation>["feed"]>["subscribe"];
  const handlers = new Map<string, (event: ReturnType<typeof EventEnvelope.parse>) => void>();
  const subscribe: Subscriber = (type, handler) => {
    handlers.set(type, (event) => {
      if (event.type === type) handler(event as Parameters<typeof handler>[0]);
    });
    return () => {
      handlers.delete(type);
    };
  };
  let state: "pending" | "ready" | "off" = "pending";
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(() =>
      Promise.resolve(
        Response.json({
          state,
          ...(state === "ready" ? { text: "The peak followed the meal." } : {}),
        }),
      ),
    );
  render(
    wrap(
      <Observation
        spaceId="fictional"
        mealId="meal"
        complete={false}
        fetch={fetcher}
        feed={{ subscribe }}
      />,
    ),
  );
  expect(await screen.findByText("The observation arrives after three hours")).toBeVisible();
  const event = (subjectKey: string) =>
    EventEnvelope.parse({
      spaceId: "fictional",
      seq: 1,
      ts: "2026-10-18T18:00:00Z",
      type: "insight.created",
      payload: { insightId: "insight", kind: "meal", subjectKey },
    });
  handlers.get("insight.created")?.(event("another-meal"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  state = "ready";
  handlers.get("insight.created")?.(event("meal"));
  expect(await screen.findByText("The peak followed the meal.")).toBeVisible();
  state = "off";
  handlers.get("insight.created")?.(event("meal"));
  await waitFor(() => {
    expect(screen.queryByText("Observation · AI")).toBeNull();
  });
});
