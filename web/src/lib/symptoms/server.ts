import { log, prisma, type Role } from "@frejsi/shared";
import { requireSpaceRole } from "@/lib/live/server";
import type { SessionDb } from "@/lib/auth/session";
import { symptomDeps, type SymptomDeps } from "./service";

let overrides: Partial<SymptomDeps & { sessionDb: SessionDb }> = {};
/** Tests only: replace the repository, the writer, the clock or the session database. */
export function configureSymptoms(deps: typeof overrides): void {
  overrides = deps;
}
/**
 * Reading is for every member, a viewer included: a symptom carries no glucose (decision 6).
 * Writing is for owner and carer; simpleMode limits are the service's, by the session.
 */
export async function authorizeSymptoms(request: Request, spaceId: string, roles: Role[]) {
  const { session, role } = await requireSpaceRole(
    request,
    spaceId,
    roles,
    overrides.sessionDb ?? prisma,
    overrides.now,
  );
  return { session, role, deps: symptomDeps(overrides) };
}
export const WRITE_ROLES: Role[] = ["owner", "carer"];
export function symptomOutcome(spaceId: string, userId: string, count: number): void {
  log.info("symptom.completed", { spaceId, userId, count });
}
