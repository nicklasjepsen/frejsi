// The only module that creates or changes invites (plan task 5). Routes, the People screens and
// the seed call these functions; nothing else writes the Invite table.
import { createHash, randomBytes } from "node:crypto";

import { HttpError, type Role } from "@frejsi/shared";

import { appOrigin, resolveTx, run, type AuthDeps, type DbDeps, type TxDeps } from "./core";

/** An invitation link is good for seven days (spec §2b). */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 32 random bytes, base64url: the `Invite.token` primary key (plan §3). */
export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What events carry instead of the token (plan §4). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** The link in the invitation. No locale: the middleware routes `/invite/<token>` to the user's. */
export function inviteUrl(token: string): string {
  return `${appOrigin()}/invite/${token}`;
}

export interface NewInvite {
  spaceId: string;
  role: Role;
  /** The invitee's name as the inviter typed it; becomes `User.name` on registration. */
  name: string;
  /** Set for an add-a-device link: registration adds a passkey to this user (spec §2b). */
  forUserId?: string;
  createdBy: string;
}

export interface CreatedInvite {
  token: string;
  url: string;
  expiresAt: Date;
}

/**
 * Creates a single-use invite and emits `invite.created` with the token's hash, in one
 * transaction (its own, or the bootstrap's).
 */
export function createInvite(
  input: NewInvite,
  deps: AuthDeps | TxDeps = {},
): Promise<CreatedInvite> {
  return run(deps, async (db, emit, now) => {
    const token = newInviteToken();
    const expiresAt = new Date(now().getTime() + INVITE_TTL_MS);
    await db.invite.create({
      data: {
        token,
        spaceId: input.spaceId,
        role: input.role,
        name: input.name,
        forUserId: input.forUserId ?? null,
        createdBy: input.createdBy,
        expiresAt,
      },
    });
    await emit(input.spaceId, "invite.created", {
      tokenHash: hashToken(token),
      role: input.role,
      name: input.name,
      ...(input.forUserId ? { forUserId: input.forUserId } : {}),
    });
    return { token, url: inviteUrl(token), expiresAt };
  });
}

/**
 * The invite behind a token while it can still be used, with its space and creator for the
 * landing page. Otherwise `not-found`, `invite-used`, `invite-revoked` or `invite-expired`, in
 * that order of precedence (plan §9).
 */
export async function loadInvite(token: string, deps: DbDeps = {}) {
  const { db, now } = resolveTx(deps);
  const invite = await db.invite.findUnique({
    where: { token },
    include: { space: true, creator: true },
  });
  if (!invite) throw new HttpError(404, "not-found");
  if (invite.usedAt) throw new HttpError(410, "invite-used");
  if (invite.revokedAt) throw new HttpError(410, "invite-revoked");
  if (invite.expiresAt.getTime() <= now().getTime()) throw new HttpError(410, "invite-expired");
  return invite;
}

/**
 * Marks the token used, once: the conditional update is the claim, so two registrations racing
 * on one link cannot both succeed. Called inside the registration transaction. A failed claim
 * names its cause: the link may have been revoked or have expired since the ceremony started.
 */
export async function markInviteUsed(token: string, deps: DbDeps = {}): Promise<void> {
  const { db, now } = resolveTx(deps);
  const at = now();
  const { count } = await db.invite.updateMany({
    where: { token, usedAt: null, revokedAt: null, expiresAt: { gt: at } },
    data: { usedAt: at },
  });
  if (count === 1) return;
  await loadInvite(token, deps);
  // Only a row that is still valid passes loadInvite; the claim then lost a race with another.
  throw new HttpError(410, "invite-used");
}

/** Revokes an unused invite and emits `invite.revoked`; People's "send again" calls this first. */
export function revokeInvite(token: string, deps: AuthDeps | TxDeps = {}): Promise<void> {
  return run(deps, async (db, emit, now) => {
    const invite = await db.invite.findUnique({ where: { token } });
    if (!invite) throw new HttpError(404, "not-found");
    const { count } = await db.invite.updateMany({
      where: { token, usedAt: null, revokedAt: null },
      data: { revokedAt: now() },
    });
    if (count !== 1) throw new HttpError(410, invite.usedAt ? "invite-used" : "invite-revoked");
    await emit(invite.spaceId, "invite.revoked", {
      tokenHash: hashToken(token),
      role: invite.role as Role,
      name: invite.name,
      ...(invite.forUserId ? { forUserId: invite.forUserId } : {}),
    });
  });
}
