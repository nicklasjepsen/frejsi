/**
 * Exports such as Dexcom Clarity's carry wall-clock times with no offset: "2026-10-15T07:30:00"
 * means 07:30 where the sensor's phone was. The space's timezone says where that was.
 */
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timezone, f);
  }
  return f;
}

/** The wall-clock time of `instant` in `timezone`, as the milliseconds of that time read as UTC. */
function wallClockAsUtc(instant: number, timezone: string): number {
  const parts = formatter(timezone).formatToParts(new Date(instant));
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
}

/** True when `timezone` is one Intl knows; the caller refuses anything else. */
export function isTimezone(timezone: string): boolean {
  try {
    formatter(timezone);
    return true;
  } catch {
    return false;
  }
}

/** The offset (local minus UTC, ms) in force at `instant`. */
function offsetAt(instant: number, timezone: string): number {
  return wallClockAsUtc(instant, timezone) - instant;
}

const HOUR = 60 * 60 * 1000;

/**
 * A wall-clock timestamp (`YYYY-MM-DDTHH:mm[:ss]`, or with a space) in `timezone` as an instant.
 * Null for anything that is not such a timestamp. Across a DST change, a wall-clock time that
 * happens twice is its first instant, and one that never happens (the skipped hour) is read with
 * the offset of the hour before it.
 */
export function localToUtc(text: string, timezone: string): Date | null {
  const match = TIMESTAMP.exec(text.trim());
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const fields = [Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? 0)];
  const [year, month, day, hour, minute, second] = fields as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59)
    return null;
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(naive);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  // The offsets a day either side of the time; the candidates are the time read with each.
  const offsets = [
    ...new Set([offsetAt(naive - 24 * HOUR, timezone), offsetAt(naive + 24 * HOUR, timezone)]),
  ];
  const valid = offsets
    .map((offset) => naive - offset)
    .filter((instant) => wallClockAsUtc(instant, timezone) === naive)
    .sort((a, b) => a - b);
  const first = valid[0];
  if (first !== undefined) return new Date(first);
  return new Date(naive - offsetAt(naive - 24 * HOUR, timezone));
}
