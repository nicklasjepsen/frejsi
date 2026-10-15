import { prisma } from "@frejsi/shared";
import { NextResponse } from "next/server";

import { computeHealth } from "./health";

export const dynamic = "force-dynamic";

/** `GET /api/health`: the release smoke and the uptime probe (plan §7, decision 22). Public. */
export async function GET(): Promise<NextResponse> {
  const health = await computeHealth({ db: prisma });
  return NextResponse.json(health, {
    status: health.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
