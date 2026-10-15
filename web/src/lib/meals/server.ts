import { log, prisma } from "@frejsi/shared";
import { requireSpaceRole } from "@/lib/live/server";
import type { SessionDb } from "@/lib/auth/session";
import { mealDeps, type MealDeps } from "./service";

let overrides: Partial<MealDeps & { sessionDb: SessionDb }> = {};
export function configureMeals(deps: typeof overrides): void {
  overrides = deps;
}
export async function authorizeMeal(request: Request, spaceId: string) {
  const { session } = await requireSpaceRole(
    request,
    spaceId,
    ["owner", "carer"],
    overrides.sessionDb ?? prisma,
  );
  return { session, deps: mealDeps(overrides) };
}
export function mealOutcome(spaceId: string, userId: string, count: number): void {
  log.info("meal.completed", { spaceId, userId, count });
}
