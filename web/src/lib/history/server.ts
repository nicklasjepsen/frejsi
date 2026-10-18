import { HttpError } from "@frejsi/shared";
import { createPhotoStoreFromEnv } from "@frejsi/shared/photos";
import { z } from "zod";
import type { SessionDb } from "@/lib/auth/session";
import { json, log, requireSpaceRole } from "@/lib/live/server";
import { PrismaHistoryRepository } from "./prisma";
import type { HistoryDeps } from "./types";
let overrides: Partial<HistoryDeps & { sessionDb: SessionDb }> = {};
export function configureHistory(deps: typeof overrides): void {
  overrides = deps;
}
/**
 * Authorization runs before constructing the repository or accessing space data. Owners and
 * carers only, and never a simpleMode session: no simple screen reads history, a meal curve or an
 * observation, and these views carry the pump record (v0.7.0 plan §4), so simpleMode shows nothing
 * new by being refused here, in the API.
 */
export async function authorizeHistory(request: Request, spaceId: string) {
  const now = overrides.now ?? (() => new Date());
  const { session } = await requireSpaceRole(
    request,
    spaceId,
    ["owner", "carer"],
    overrides.sessionDb,
    now,
  );
  if (session.simpleMode) throw new HttpError(403, "forbidden");
  const deps: HistoryDeps = {
    repo: overrides.repo ?? new PrismaHistoryRepository(),
    photos: overrides.photos !== undefined ? overrides.photos : createPhotoStoreFromEnv(),
    now,
  };
  return { session, deps };
}
export function historyDate(request: Request, name: string): string | null {
  const raw = new URL(request.url).searchParams.get(name);
  if (raw === null) return null;
  const parsed = z.iso.date().safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "validation");
  return parsed.data;
}
export function includeReadings(request: Request): boolean {
  const raw = new URL(request.url).searchParams.get("readings");
  if (raw === null || raw === "1") return true;
  if (raw === "0") return false;
  throw new HttpError(400, "validation");
}
export function historyResponse(
  route: string,
  spaceId: string,
  userId: string,
  count: number,
  view: unknown,
) {
  log.info("history.read", { route, spaceId, userId, count });
  return json(view);
}
