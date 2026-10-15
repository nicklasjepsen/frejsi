import { z } from "zod";

/** Find a local date boundary, including DST transitions that skip local midnight. */
export function dayRange(date: string, timezone: string): [Date, Date] {
  z.iso.date().parse(date);
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const localDate = (ms: number) => {
    const parts = formatter.formatToParts(new Date(ms));
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
  };
  const midnight = Date.parse(`${date}T00:00:00Z`);
  const nextDate = new Date(midnight + 86400000).toISOString().slice(0, 10);
  const boundary = (target: string, approximate: number) => {
    let low = approximate - 36 * 3600000;
    let high = approximate + 36 * 3600000;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (localDate(middle) < target) low = middle + 1;
      else high = middle;
    }
    return new Date(low);
  };
  return [boundary(date, midnight), boundary(nextDate, midnight + 86400000)];
}
