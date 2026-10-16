// "Send rettelsen til Open Food Facts" (spec §4): the one place a FoodContributor is called. It runs
// only for an explicit POST from a carer or owner, builds a correction from numbers alone (never a
// name, never a person), writes nothing to `Food`, and emits `food.contributed` on success.
import { createHash } from "node:crypto";
import { HttpError, type FoodContributor, type SessionContext } from "@frejsi/shared";
import { ContributionsView, FoodCorrection } from "@frejsi/shared/schemas/food";
import { foodContributors } from "@frejsi/shared/food";
import { assertRole } from "@/lib/auth/session";
import { foodTransaction, resolveFoods, type FoodDeps } from "@/lib/foods/core";

/** How long one send may take before it counts as an error. */
const SEND_TIMEOUT_MS = 10_000;

export interface ContributionDeps extends FoodDeps {
  contributors?: FoodContributor[];
}
let overrides: FoodContributor[] | undefined;
/** Tests only: replace the contributors the environment would give. */
export function configureContributions(contributors?: FoodContributor[]): void {
  overrides = contributors;
}
export function resolveContributions(input: ContributionDeps = {}) {
  return {
    ...resolveFoods(input),
    contributors: input.contributors ?? overrides ?? foodContributors(process.env),
  };
}
export type ResolvedContributions = ReturnType<typeof resolveContributions>;

/** Pseudonymous and stable per space: the first 32 hex characters of sha256(spaceId). */
export function appRefOf(spaceId: string): string {
  return createHash("sha256").update(spaceId).digest("hex").slice(0, 32);
}

/** Which plugins can receive a correction on this deployment. Ids only. */
export function availableContributions(
  spaceId: string,
  session: SessionContext,
  deps: ResolvedContributions,
): ContributionsView {
  assertRole(session, spaceId, "owner", "carer");
  return ContributionsView.parse({ available: deps.contributors.map((c) => c.id) });
}

/**
 * Sends the food's current numbers to the source it came from. Resolves on `ok`; every other
 * answer is an `HttpError` and emits nothing. Role, simpleMode and availability are all checked
 * before the food is read or the contributor is called.
 */
export async function contributeFood(
  spaceId: string,
  session: SessionContext,
  foodId: string,
  deps: ResolvedContributions,
): Promise<void> {
  assertRole(session, spaceId, "owner", "carer");
  if (session.simpleMode) throw new HttpError(400, "simple-mode");
  if (deps.contributors.length === 0) throw new HttpError(503, "contribution-unavailable");
  const row = await deps.db.food.findFirst({ where: { id: foodId, spaceId } });
  const contributor = row && deps.contributors.find((c) => c.id === row.origin);
  if (!row || !contributor || !row.barcode) throw new HttpError(404, "not-found");
  const portions = JSON.parse(row.portions) as { grams?: number; label?: string }[];
  const serving = portions.find((p) => p.grams !== undefined);
  const carbs = row.carbsPer100g == null ? undefined : Number(row.carbsPer100g);
  const correction = FoodCorrection.safeParse({
    barcode: row.barcode,
    ...(carbs === undefined ? {} : { carbsPer100g: carbs }),
    ...(serving?.grams === undefined ? {} : { servingSize: { grams: serving.grams } }),
    appRef: appRefOf(spaceId),
  });
  if (!correction.success) throw new HttpError(404, "not-found");
  let status: string;
  try {
    status = (await contributor.contribute(correction.data, AbortSignal.timeout(SEND_TIMEOUT_MS)))
      .status;
  } catch {
    status = "error";
  }
  if (status === "rate-limited") throw new HttpError(429, "contribution-rejected");
  if (status !== "ok") throw new HttpError(502, "contribution-rejected");
  await foodTransaction(deps, (_tx, emit) =>
    emit(spaceId, "food.contributed", { foodId, source: contributor.id }),
  );
}
