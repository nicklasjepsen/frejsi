/** The load-timing report's query (components/shell/LoadTiming.tsx). Numbers and fixed words only. */
export const LOAD_TIMING_PATH = "/api/diag/load";

export type Fields = Record<string, string | number>;

export const ms = (value: number | undefined): number | undefined =>
  value === undefined || !Number.isFinite(value) || value < 0 ? undefined : Math.round(value);

/** The report's query: timings of the navigation entry plus a few facts about this open. */
export function loadTimingQuery(
  entry: PerformanceNavigationTiming | undefined,
  extra: Fields,
): string {
  const fields: Fields = { ...extra };
  if (entry) {
    const marks: Record<string, number | undefined> = {
      worker: entry.workerStart > 0 ? entry.workerStart : undefined,
      fetch: entry.fetchStart,
      dns:
        entry.domainLookupStart > 0 ? entry.domainLookupEnd - entry.domainLookupStart : undefined,
      connect: entry.connectStart > 0 ? entry.connectEnd - entry.connectStart : undefined,
      request: entry.requestStart,
      firstByte: entry.responseStart,
      response: entry.responseEnd,
      interactive: entry.domInteractive,
      loaded: entry.loadEventEnd > 0 ? entry.loadEventEnd : entry.domContentLoadedEventEnd,
      redirects: entry.redirectCount,
    };
    fields.type = entry.type;
    for (const [key, value] of Object.entries(marks)) {
      const rounded = ms(value);
      if (rounded !== undefined) fields[key] = rounded;
    }
  }
  return new URLSearchParams(
    Object.entries(fields).map(([key, value]) => [key, String(value)]),
  ).toString();
}

/**
 * The report's URL. The fields go in the path, "type:navigate,os:ios,…": App Insights names a
 * request on a dynamic route by its concrete path, while a static route's name and URL drop the
 * query (v0.7.5 showed only "GET /api/diag/load/route").
 */
export function loadTimingUrl(query: string): string {
  return `${LOAD_TIMING_PATH}/${query.replaceAll("&", ",").replaceAll("=", ":")}`;
}

/** What `/api/diag/load/:report` accepts: fixed words, versions and numbers only. */
export const LOAD_REPORT = /^[A-Za-z0-9_.:,-]{1,400}$/;
