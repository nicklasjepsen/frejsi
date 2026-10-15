import { HttpError } from "@frejsi/shared";

import { resolveTx, type DbDeps } from "./core";

export type ChallengeKind = "register" | "login";

/** A WebAuthn ceremony has five minutes (plan §3, `AuthChallenge.expiresAt`). */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface NewChallenge {
  kind: ChallengeKind;
  /** The base64url challenge from `@simplewebauthn/server`'s options. */
  challenge: string;
  inviteToken?: string;
  userId?: string;
}

export interface ConsumedChallenge {
  challenge: string;
  inviteToken: string | null;
  userId: string | null;
}

/**
 * Stores the challenge of a ceremony that has just started. Expired rows are swept at the same
 * time, so abandoned ceremonies never pile up.
 */
export async function createChallenge(
  input: NewChallenge,
  deps: DbDeps = {},
): Promise<{ id: string }> {
  const { db, now } = resolveTx(deps);
  const at = now();
  await db.authChallenge.deleteMany({ where: { expiresAt: { lt: at } } });
  const row = await db.authChallenge.create({
    data: {
      challenge: input.challenge,
      kind: input.kind,
      inviteToken: input.inviteToken ?? null,
      userId: input.userId ?? null,
      expiresAt: new Date(at.getTime() + CHALLENGE_TTL_MS),
    },
  });
  return { id: row.id };
}

/**
 * Takes the challenge out of the table and returns it, once. The delete is the claim: of two
 * requests racing on the same id, only the one whose delete removed the row gets it. An expired or
 * unknown challenge is a stale request, not an authorization failure, hence `validation`. The
 * message stays at the code: the sign-in screen translates it (plan §9).
 */
export async function consumeChallenge(
  id: string,
  kind: ChallengeKind,
  deps: DbDeps = {},
): Promise<ConsumedChallenge> {
  const { db, now } = resolveTx(deps);
  const row = await db.authChallenge.findUnique({ where: { id } });
  if (row?.kind !== kind) throw stale();
  const { count } = await db.authChallenge.deleteMany({ where: { id } });
  if (count !== 1 || row.expiresAt.getTime() <= now().getTime()) throw stale();
  return { challenge: row.challenge, inviteToken: row.inviteToken, userId: row.userId };
}

function stale(): HttpError {
  return new HttpError(400, "validation");
}
