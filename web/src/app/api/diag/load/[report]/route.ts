import { NextResponse } from "next/server";

import { LOAD_REPORT } from "@/lib/diag/load-timing";

export const dynamic = "force-dynamic";

/**
 * `GET /api/diag/load/<fields>`: where a slow open spent its time (components/shell/LoadTiming.tsx).
 * The request is the report, recorded by App Insights under its concrete path; nothing is stored.
 * Public, like `/api/health`: only fixed words and numbers pass.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ report: string }> },
): Promise<NextResponse> {
  const { report } = await params;
  const status = LOAD_REPORT.test(decodeURIComponent(report)) ? 204 : 400;
  return new NextResponse(null, { status, headers: { "cache-control": "no-store" } });
}
