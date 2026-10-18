import "@testing-library/jest-dom/vitest";

import type { Role } from "@frejsi/shared/schemas/index";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FeedEventType } from "@/lib/live/live-feed";

import { PUMP_RECHECK_MS, PUMP_REFRESH_ON, usePumpHistory } from "./usePumpHistory";

const FROM = "2026-10-14T22:00:00.000Z";
const TO = "2026-10-15T22:00:00.000Z";
const view = {
  boluses: [
    { id: "b1", ts: "2026-10-15T03:10:00.000Z", units: 0.6, kind: "automatic" },
    { id: "b2", ts: "2026-10-15T11:58:00.000Z", units: 2.4, kind: "standard", mealId: "m1" },
  ],
  reach: "2026-10-15T11:58:00.000Z",
  status: "connected",
};

let calls: string[];
let answer: () => Response;
const handlers = new Map<string, () => void>();
const subscribe = (type: FeedEventType, handler: () => void) => {
  handlers.set(type, handler);
  return () => {
    handlers.delete(type);
  };
};

function Probe({
  role = "owner",
  simpleMode = false,
  enabled = true,
  from = FROM,
}: {
  role?: Role;
  simpleMode?: boolean;
  enabled?: boolean;
  from?: string;
}) {
  const pump = usePumpHistory("s1", from, TO, { subscribe, role, simpleMode, enabled });
  return (
    <div data-testid="probe" data-status={pump.status}>
      {pump.status === "ready"
        ? pump.boluses.map((b) => `${b.id}:${String(b.units)}`).join(",")
        : ""}
      <span data-testid="reach">{pump.status === "ready" ? (pump.reach ?? "") : ""}</span>
    </div>
  );
}

beforeEach(() => {
  calls = [];
  handlers.clear();
  answer = () => Response.json(view);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => {
      const url = new URL(input, "https://frejsi.example");
      calls.push(`${url.pathname}${url.search}`);
      return Promise.resolve(answer());
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ready = () =>
  waitFor(() => {
    expect(screen.getByTestId("probe")).toHaveAttribute("data-status", "ready");
  });

describe("usePumpHistory (v0.7.0 plan §4, §6)", () => {
  it("reads its window once through the pump route", async () => {
    const { rerender } = render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveAttribute("data-status", "loading");
    await ready();
    expect(screen.getByTestId("probe")).toHaveTextContent("b1:0.6,b2:2.4");
    expect(screen.getByTestId("reach")).toHaveTextContent("2026-10-15T11:58:00.000Z");
    rerender(<Probe />);
    rerender(<Probe />);
    expect(calls).toEqual([
      `/api/spaces/s1/pump?from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}`,
    ]);
  });

  it("reads again on pump.imported and pump.meals, and on no other event", async () => {
    expect(PUMP_REFRESH_ON).toEqual(["pump.imported", "pump.meals"]);
    render(<Probe />);
    await ready();
    expect([...handlers.keys()].sort()).toEqual(["pump.imported", "pump.meals"]);
    act(() => {
      handlers.get("pump.imported")?.();
    });
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    act(() => {
      handlers.get("pump.meals")?.();
    });
    await waitFor(() => {
      expect(calls).toHaveLength(3);
    });
  });

  it("reads a new window when the screen moves to another day", async () => {
    const { rerender } = render(<Probe />);
    await ready();
    rerender(<Probe from="2026-10-13T22:00:00.000Z" />);
    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[1]).toContain(encodeURIComponent("2026-10-13T22:00:00.000Z"));
  });

  it("makes no request and subscribes to nothing for a viewer", async () => {
    render(<Probe role="viewer" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toEqual([]);
    expect(handlers.size).toBe(0);
    expect(screen.getByTestId("probe")).toHaveAttribute("data-status", "off");
  });

  it("makes no request and subscribes to nothing for a simpleMode session", async () => {
    render(<Probe simpleMode />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toEqual([]);
    expect(handlers.size).toBe(0);
    expect(screen.getByTestId("probe")).toHaveAttribute("data-status", "off");
  });

  it("waits while the screen says not yet, then reads", async () => {
    const { rerender } = render(<Probe enabled={false} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toEqual([]);
    rerender(<Probe />);
    await ready();
    expect(calls).toHaveLength(1);
  });

  it("is failed after a refused or malformed answer, and reads again on the next event", async () => {
    answer = () => Response.json({ error: { code: "forbidden" } }, { status: 403 });
    render(<Probe />);
    await waitFor(() => {
      expect(screen.getByTestId("probe")).toHaveAttribute("data-status", "failed");
    });
    answer = () => Response.json(view);
    act(() => {
      handlers.get("pump.imported")?.();
    });
    await ready();
  });

  describe("recovering without an event", () => {
    const failing = () => Response.json({ error: { code: "internal" } }, { status: 500 });
    const settle = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
    const status = () => screen.getByTestId("probe").getAttribute("data-status");

    beforeEach(() => {
      vi.useFakeTimers({ now: new Date("2026-10-15T12:00:00.000Z") });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("reads a failed first read again on the recheck, without waiting for a pump event", async () => {
      answer = failing;
      render(<Probe />);
      await settle();
      expect(status()).toBe("failed");
      answer = () => Response.json(view);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PUMP_RECHECK_MS);
      });
      expect(status()).toBe("ready");
      expect(screen.getByTestId("probe")).toHaveTextContent("b1:0.6,b2:2.4");
      expect(calls).toHaveLength(2);
    });

    it("keeps trying while the read keeps failing", async () => {
      answer = failing;
      render(<Probe />);
      await settle();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PUMP_RECHECK_MS);
      });
      expect(status()).toBe("failed");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PUMP_RECHECK_MS);
      });
      expect(calls).toHaveLength(3);
    });

    it("keeps the drawn boluses when a refresh after an event fails, and retries it", async () => {
      render(<Probe />);
      await settle();
      expect(status()).toBe("ready");
      answer = failing;
      act(() => {
        handlers.get("pump.imported")?.();
      });
      await settle();
      expect(calls).toHaveLength(2);
      expect(status()).toBe("ready");
      expect(screen.getByTestId("probe")).toHaveTextContent("b1:0.6,b2:2.4");
      answer = () => Response.json({ ...view, boluses: [view.boluses[0]] });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PUMP_RECHECK_MS);
      });
      expect(calls).toHaveLength(3);
      expect(screen.getByTestId("probe")).toHaveTextContent("b1:0.6");
      expect(screen.getByTestId("probe")).not.toHaveTextContent("b2");
    });

    it("does not read again on the recheck once a read has succeeded", async () => {
      render(<Probe />);
      await settle();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(PUMP_RECHECK_MS * 3);
      });
      expect(calls).toHaveLength(1);
    });

    it("shows the failure, not the last window's boluses, when a new window's read fails", async () => {
      const { rerender } = render(<Probe />);
      await settle();
      answer = failing;
      rerender(<Probe from="2026-10-13T22:00:00.000Z" />);
      await settle();
      expect(status()).toBe("failed");
    });
  });
});
