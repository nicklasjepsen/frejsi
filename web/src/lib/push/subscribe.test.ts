import { expect, it, vi } from "vitest";
import { setPushEnabled, type PushBrowser } from "./subscribe";
function setup(permission: NotificationPermission = "granted") {
  const calls: { url: string; init?: RequestInit }[] = [];
  const permissionRequest = vi.fn(() => Promise.resolve(permission));
  const subscription = {
    toJSON: () => ({
      expirationTime: null,
      endpoint: "https://push.example/device",
      keys: { p256dh: "fictional", auth: "fictional" },
    }),
  } as unknown as PushSubscription;
  const subscribe = vi.fn(() => Promise.resolve(subscription));
  const browser: PushBrowser = {
    permission: permissionRequest,
    manager: () => Promise.resolve({ getSubscription: () => Promise.resolve(null), subscribe }),
    fetch: ((url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      return Promise.resolve(Response.json({ ok: true }));
    }) as typeof fetch,
  };
  return { browser, calls, permissionRequest, subscribe, subscription };
}
it("does nothing until invoked, then requests permission, uses the runtime key and saves", async () => {
  const s = setup();
  expect(s.permissionRequest).not.toHaveBeenCalled();
  expect(s.calls).toEqual([]);
  expect(await setPushEnabled("s1", "AQID", true, s.browser)).toBe("on");
  expect(s.subscribe).toHaveBeenCalledWith({
    userVisibleOnly: true,
    applicationServerKey: new Uint8Array([1, 2, 3]),
  });
  expect(JSON.parse(s.calls.at(0)?.init?.body as string)).toEqual({
    spaceId: "s1",
    subscription: {
      endpoint: "https://push.example/device",
      keys: { p256dh: "fictional", auth: "fictional" },
    },
  });
  expect(s.calls.at(0)?.init?.method).toBe("POST");
});
it("denied permission never subscribes or posts", async () => {
  const s = setup("denied");
  expect(await setPushEnabled("s1", "AQID", true, s.browser)).toBe("denied");
  expect(s.calls).toEqual([]);
  expect(s.subscribe).not.toHaveBeenCalled();
});
it("removes the current-space registration without revoking browser subscriptions for other spaces", async () => {
  const s = setup();
  s.browser.manager = () =>
    Promise.resolve({
      getSubscription: () => Promise.resolve(s.subscription),
      subscribe: s.subscribe,
    });
  expect(await setPushEnabled("s1", "AQID", false, s.browser)).toBe("off");
  expect(s.calls.at(0)?.init?.method).toBe("DELETE");
  expect(s.permissionRequest).not.toHaveBeenCalled();
});
it("keeps a dismissed permission prompt off so the person can try again", async () => {
  const s = setup("default");
  expect(await setPushEnabled("s1", "AQID", true, s.browser)).toBe("off");
  expect(s.calls).toEqual([]);
  expect(s.subscribe).not.toHaveBeenCalled();
});
