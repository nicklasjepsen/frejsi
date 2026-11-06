import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * `GET /api/diag/load?…`: where a slow open spent its time (components/shell/LoadTiming.tsx). The
 * request is the report, recorded by App Insights with its query; nothing is stored or read.
 * Public, like `/api/health`: it carries only numbers and fixed words.
 */
export function GET(): NextResponse {
  return new NextResponse(null, { status: 204, headers: { "cache-control": "no-store" } });
}
