// Clock arithmetic in the space's timezone for the confirm screen's header and time field.
// No timezone constant anywhere (decision 26): the zone always comes from the space.
import { formatClock } from "@/lib/i18n/time";

function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    day: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: get("hour") * 60 + get("minute"),
  };
}

export const isSameLocalDay = (a: Date, b: Date, timeZone: string) =>
  localParts(a, timeZone).day === localParts(b, timeZone).day;

/** The same local day as `base`, at the local `HH:MM`; null for anything else. */
export function withLocalTime(base: Date, hhmm: string, timeZone: string): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const wanted = Number(match[1]) * 60 + Number(match[2]);
  if (wanted >= 24 * 60 || Number(match[2]) >= 60) return null;
  const shifted = new Date(base.getTime() + (wanted - localParts(base, timeZone).minutes) * 60_000);
  shifted.setUTCSeconds(0, 0);
  // Across a DST change the offset moves by an hour; correct once by re-reading the clock.
  const drift = wanted - localParts(shifted, timeZone).minutes;
  return drift === 0 ? shifted : new Date(shifted.getTime() + drift * 60_000);
}

export { formatClock };
