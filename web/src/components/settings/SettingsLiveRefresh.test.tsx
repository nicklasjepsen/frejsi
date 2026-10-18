import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ refresh: vi.fn(), listeners: new Map<string, () => void>() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/live/useLiveFeed", () => ({
  useLiveFeed: (_space: string, options: { readings: boolean }) => {
    if (options.readings) throw new Error("Settings must not request readings");
    return {
      subscribe: (type: string, callback: () => void) => {
        mocks.listeners.set(type, callback);
        return () => {
          mocks.listeners.delete(type);
        };
      },
    };
  },
}));
import { SettingsLiveRefresh } from "./SettingsLiveRefresh";
afterEach(() => {
  cleanup();
  mocks.refresh.mockClear();
  mocks.listeners.clear();
});
it("refreshes server settings on space.updated and unsubscribes on unmount", () => {
  const view = render(<SettingsLiveRefresh spaceId="s1" />);
  mocks.listeners.get("space.updated")?.();
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(mocks.listeners.size).toBe(0);
});

it("refreshes on the pump events only when asked for them", () => {
  const plain = render(<SettingsLiveRefresh spaceId="s1" />);
  expect(mocks.listeners.has("pump.imported")).toBe(false);
  expect(mocks.listeners.has("pump.status")).toBe(false);
  plain.unmount();
  const view = render(<SettingsLiveRefresh spaceId="s1" pump />);
  mocks.listeners.get("pump.imported")?.();
  mocks.listeners.get("pump.status")?.();
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(mocks.listeners.size).toBe(0);
});
