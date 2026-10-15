import { emit as defaultEmit, log, prisma, type EmitFn } from "@frejsi/shared";

import type { SessionDb } from "@/lib/auth/session";
import { requireSpaceRole } from "@/lib/live/server";
import type { MealDeps } from "@/lib/meals/service";

import type { ImportDeps, ImportServiceDb } from "./service";

interface Overrides {
  sessionDb?: SessionDb;
  db?: ImportServiceDb;
  emit?: EmitFn;
  meals?: Partial<MealDeps>;
  now?: () => Date;
}

let overrides: Overrides = {};

/** Tests only: the session store, the delegates, the emitter and the meal deps. */
export function configureImport(deps: Overrides): void {
  overrides = deps;
}

/** The owner's session, or a refusal: carers and viewers cannot import (#154). */
export async function authorizeImport(request: Request, spaceId: string) {
  const { session } = await requireSpaceRole(
    request,
    spaceId,
    ["owner"],
    overrides.sessionDb ?? prisma,
    overrides.now,
  );
  const deps: ImportDeps = {
    db: overrides.db ?? prisma,
    emit: overrides.emit ?? defaultEmit,
    meals: overrides.meals ?? (overrides.now ? { now: overrides.now } : {}),
  };
  return { session, deps };
}

/** Counts and ids only, never a row of the file. */
export function importOutcome(spaceId: string, userId: string, readingsAdded: number): void {
  log.info("import.completed", { route: "spaces.import", spaceId, userId, count: readingsAdded });
}
