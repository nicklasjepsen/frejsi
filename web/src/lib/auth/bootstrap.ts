// The one-shot bootstrap (plan §6, decision 8): creates the first space and the owner's invite,
// guarded by the Key Vault-held BOOTSTRAP_TOKEN and dead once any space exists.
import { createHash, timingSafeEqual } from "node:crypto";

import { HttpError } from "@frejsi/shared";
import { z } from "zod";

import { resolve, transact, type AuthDeps } from "./core";
import { createInvite } from "./invites";
import { addMember } from "./members";

export const BOOTSTRAP_TOKEN_HEADER = "x-bootstrap-token";

function isTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The body of `POST /api/bootstrap`. The timezone is typed by the owner; nothing is defaulted. */
export const BootstrapRequest = z.object({
  spaceName: z.string().trim().min(1).max(80),
  ownerName: z.string().trim().min(1).max(80),
  timezone: z.string().trim().min(1).refine(isTimezone, { message: "not an IANA timezone" }),
});
export type BootstrapRequest = z.infer<typeof BootstrapRequest>;

/**
 * Constant-time comparison of the presented token with the configured one. Both sides are hashed
 * first so that lengths never leak through `timingSafeEqual`'s length check, and an unset or
 * empty configured token matches nothing.
 */
export function tokenMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export interface BootstrapInput {
  token: string | null;
  body: unknown;
}

export interface BootstrapResult {
  spaceId: string;
  inviteUrl: string;
  expiresAt: Date;
}

export interface BootstrapDeps extends AuthDeps {
  /** Defaults to `BOOTSTRAP_TOKEN`; tests pass their own. */
  expectedToken?: string | undefined;
}

/**
 * 404 once any space exists (the endpoint is dead, whoever asks), 401 on a wrong token, 400 on a
 * bad body. Then, in one transaction: the space, the owner as a user with the owner membership,
 * and a single-use add-a-device invite for that user, since `Invite.createdBy` needs a user and
 * the owner's first passkey has to attach to the user who owns the space. `member.joined` and
 * `invite.created` follow the commit. The URL is returned once and never logged.
 */
export async function bootstrapSpace(
  input: BootstrapInput,
  deps: BootstrapDeps = {},
): Promise<BootstrapResult> {
  const { db, emit, now } = resolve(deps);
  const expectedToken = "expectedToken" in deps ? deps.expectedToken : process.env.BOOTSTRAP_TOKEN;

  if ((await db.space.count()) > 0) throw new HttpError(404, "not-found");
  if (!tokenMatches(input.token, expectedToken)) throw new HttpError(401, "forbidden");
  const parsed = BootstrapRequest.safeParse(input.body);
  if (!parsed.success) throw new HttpError(400, "validation");
  const body = parsed.data;

  return transact(db, emit, async (tx, emitLater) => {
    const txDeps = { db: tx, emit: emitLater, now };
    const space = await tx.space.create({
      data: { name: body.spaceName, timezone: body.timezone },
    });
    const owner = await tx.user.create({ data: { name: body.ownerName } });
    await addMember({ spaceId: space.id, userId: owner.id, role: "owner" }, txDeps);
    const invite = await createInvite(
      {
        spaceId: space.id,
        role: "owner",
        name: body.ownerName,
        forUserId: owner.id,
        createdBy: owner.id,
      },
      txDeps,
    );
    return { spaceId: space.id, inviteUrl: invite.url, expiresAt: invite.expiresAt };
  });
}
