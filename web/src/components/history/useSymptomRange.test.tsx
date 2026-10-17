import "@testing-library/jest-dom/vitest";

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FeedEventType } from "@/lib/live/live-feed";

import { SYMPTOM_REFRESH_ON, useSymptomRange } from "./useSymptomRange";

const FROM = "2026-10-13T22:00:00.000Z";
const TO = "2026-10-14T22:00:00.000Z";
const symptom = {
  id: "s1",
  kind: "stomach-ache",
  ts: "2026-10-14T12:30:00.000Z",
  byUserId: "u1",
  byName: "Jonas",
};

let calls: string[];
let answer: () => unknown;
const handlers = new Map<string, () => void>();
const subscribe = (type: FeedEventType, handler: () => void) => {
  handlers.set(type, handler);
  return () => {
    handlers.delete(type);
  };
};

function Probe({ enabled = true }: { enabled?: boolean }) {
  const range = useSymptomRange("s1", FROM, TO, subscribe, enabled);
  return (
    <div data-testid="probe" data-status={range.status}>
      {range.status === "ready" ? range.symptoms.map((s) => s.kind).join(",") : ""}
      <span data-testid="kinds">{range.kinds.map((k) => k.id).join(",")}</span>
    </div>
  );
}

beforeEach(() => {
  calls = [];
  handlers.clear();
  answer = () => ({ symptoms: [symptom] });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      const url = new URL(input, "https://frejsi.example");
      calls.push(`${url.pathname}${url.search}`);
      if (url.pathname.endsWith("/symptoms/kinds"))
        return Promise.resolve(
          Response.json({ kinds: [{ id: "custom:itchy", label: { da: "Kløe", en: "Itchy" } }] }),
        );
      return Promise.resolve(Response.json(answer()));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useSymptomRange (v0.6.0 plan §5)", () => {
  it("reads the range through the symptoms route, with the space's kinds", async () => {
    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveAttribute("data-status", "loading");
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveAttribute("data-status", "ready");
    });
    expect(screen.getByTestId("probe")).toHaveTextContent("stomach-ache");
    expect(screen.getByTestId("kinds")).toHaveTextContent("custom:itchy");
    expect(calls).toContain(
      `/api/spaces/s1/symptoms?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
    );
  });

  it("reads again on every symptom event and never on a meal event", async () => {
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveAttribute("data-status", "ready");
    });
    expect([...handlers.keys()]).toEqual(SYMPTOM_REFRESH_ON);
    expect(handlers.has("meal.created")).toBe(false);
    const before = calls.filter((c) => c.includes("symptoms?")).length;
    answer = () => ({ symptoms: [symptom, { ...symptom, id: "s2", kind: "dizzy" }] });
    act(() => {
      handlers.get("symptom.created")?.();
    });
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveTextContent("stomach-ache,dizzy");
    });
    expect(calls.filter((c) => c.includes("symptoms?"))).toHaveLength(before + 1);
  });

  it("reports a failed read and does nothing while disabled", async () => {
    answer = () => {
      throw new Error("down");
    };
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveAttribute("data-status", "failed");
    });
    cleanup();
    calls = [];
    render(<Probe enabled={false} />);
    await Promise.resolve();
    expect(calls).toEqual([]);
    expect(screen.getByTestId("probe")).toHaveAttribute("data-status", "loading");
  });
});
