/**
 * `HH:MM` with a colon in the space's timezone, as every artboard draws a time ("15:13"); the
 * Danish Intl default would write "15.13". Locale-independent on purpose. The zone is required:
 * the runtime's default zone is UTC on the server and the viewer's in the browser, so a fallback
 * would render one time in the SSR HTML and another after hydration.
 */
export function formatClock(at: Date, timeZone: string): string {
  if (Number.isNaN(at.getTime())) return "–";
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(at);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}
