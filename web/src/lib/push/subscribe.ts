/** Browser APIs sit behind a small interface so tests never request a real permission or endpoint. */
export interface PushBrowser {
  permission(): Promise<NotificationPermission>;
  manager(): Promise<Pick<PushManager, "getSubscription" | "subscribe">>;
  fetch: typeof fetch;
}
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}
const browser = (): PushBrowser => ({
  permission: () => Notification.requestPermission(),
  manager: async () => (await navigator.serviceWorker.ready).pushManager,
  fetch: (...args) => fetch(...args),
});
function applicationKey(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (c) =>
    c.charCodeAt(0),
  );
}
export async function currentPushEnabled(spaceId: string, deps = browser()): Promise<boolean> {
  if (!(await (await deps.manager()).getSubscription())) return false;
  const res = await deps.fetch(
    `/api/users/me/push-subscriptions?spaceId=${encodeURIComponent(spaceId)}`,
  );
  if (!res.ok) throw new Error("Push status unavailable");
  const data: unknown = await res.json();
  return (
    typeof data === "object" && data !== null && "subscribed" in data && data.subscribed === true
  );
}
/** Called only by the Settings switch's tap handler. No permission prompt on mount. */
export async function setPushEnabled(
  spaceId: string,
  publicKey: string,
  enabled: boolean,
  deps = browser(),
): Promise<"on" | "off" | "denied"> {
  if (enabled && (await deps.permission()) !== "granted") return "denied";
  const manager = await deps.manager();
  const subscription =
    (await manager.getSubscription()) ??
    (enabled
      ? await manager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationKey(publicKey),
        })
      : null);
  if (!subscription) return "off";
  const json = subscription.toJSON();
  const value = {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
  };
  const res = await deps.fetch("/api/users/me/push-subscriptions", {
    method: enabled ? "POST" : "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spaceId, subscription: value }),
  });
  if (!res.ok) throw new Error("Push registration unavailable");
  return enabled ? "on" : "off";
}
