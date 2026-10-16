/** Browser-issued endpoints only: a subscription must not turn the server into an HTTP proxy. */
export function pushEndpointAllowed(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      (!url.port || url.port === "443") &&
      !url.username &&
      !url.password &&
      (["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"].includes(
        url.hostname,
      ) ||
        url.hostname.endsWith(".notify.windows.com"))
    );
  } catch {
    return false;
  }
}
