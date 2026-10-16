import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import { PushRow } from "./PushRow";

function mount(permission: NotificationPermission = "granted", existing = false) {
  const requestPermission = vi.fn(() => Promise.resolve(permission));
  vi.stubGlobal("Notification", { permission: "default", requestPermission });
  vi.stubGlobal("PushManager", function PushManagerFake() {
    return undefined;
  });
  const sub = {
    toJSON: () => ({
      endpoint: "https://push.example/device",
      expirationTime: null,
      keys: { p256dh: "fictional", auth: "fictional" },
    }),
  };
  Object.defineProperty(navigator, "serviceWorker", {
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: () => Promise.resolve(existing ? sub : null),
          subscribe: () => Promise.resolve(sub),
        },
      }),
    },
    configurable: true,
  });
  const calls: string[] = [];
  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
    calls.push(init?.method ?? "GET");
    return Promise.resolve(Response.json(init ? { ok: true } : { subscribed: existing }));
  });
  render(
    <I18nProvider locale="da" messages={getMessages("da")}>
      <PushRow spaceId="s1" publicKey="AQID" subject="Example Child" />
    </I18nProvider>,
  );
  return { requestPermission, calls };
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});
it("never prompts on mount; enables and disables with persistent API writes on taps", async () => {
  const s = mount();
  const toggle = screen.getByRole("switch");
  await waitFor(() => expect(toggle).not.toBeDisabled());
  expect(s.requestPermission).not.toHaveBeenCalled();
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  expect(s.calls).toEqual(["POST"]);
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  // The fake browser returns no existing subscription in this test; disabling is already off.
  expect(s.requestPermission).toHaveBeenCalledTimes(1);
});
it("reads the session registration and removes it when switched off", async () => {
  const s = mount("granted", true);
  const toggle = screen.getByRole("switch");
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "false"));
  expect(s.calls).toEqual(["GET", "DELETE"]);
  expect(s.requestPermission).not.toHaveBeenCalled();
});
it("shows the denied message and sends no registration", async () => {
  const s = mount("denied");
  const toggle = screen.getByRole("switch");
  await waitFor(() => expect(toggle).not.toBeDisabled());
  fireEvent.click(toggle);
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Beskeder er slået fra i din browser",
  );
  expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(s.calls).toEqual([]);
});
it("keeps the saved on state visible when disabling fails", async () => {
  mount("granted", true);
  const toggle = screen.getByRole("switch");
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  vi.stubGlobal("fetch", () => Promise.resolve(Response.json({ error: {} }, { status: 503 })));
  fireEvent.click(toggle);
  expect(await screen.findByRole("status")).toHaveTextContent("Beskeder kunne ikke gemmes");
  expect(toggle).toHaveAttribute("aria-checked", "true");
});
