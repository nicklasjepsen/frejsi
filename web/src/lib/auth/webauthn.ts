// Passkeys with @simplewebauthn/server (spec §2b, plan §6): registration through an invite,
// discoverable-credential login, device removal and logout. Sessions are server-side rows so
// that removing a device revokes it at once; the cookie carries only the session id.
import { randomBytes, randomUUID } from "node:crypto";

import { HttpError, type Role } from "@frejsi/shared";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";

import { consumeChallenge, createChallenge } from "./challenges";
import {
  appOrigin,
  resolve,
  rpId,
  transact,
  type AuthDeps,
  type AuthTx,
  type Emitter,
} from "./core";
import { loadInvite, markInviteUsed } from "./invites";
import { addMember } from "./members";
import { SESSION_MAX_AGE_SECONDS } from "./session";

/** The user-visible name of the relying party in the passkey prompt. */
const RP_NAME = "Frejsi";

export interface CeremonyStart<Options> {
  challengeId: string;
  options: Options;
}

export interface RegistrationInput {
  challengeId: string;
  response: RegistrationResponseJSON;
  /** What the person calls this device; shown on People. Optional. */
  deviceName?: string;
}

export interface RegistrationResult {
  sessionId: string;
  expiresAt: Date;
  userId: string;
  passkeyId: string;
  spaceId: string;
  role: Role;
}

export interface LoginInput {
  challengeId: string;
  response: AuthenticationResponseJSON;
}

export interface LoginResult {
  sessionId: string;
  expiresAt: Date;
  userId: string;
}

/**
 * The `Origin` header of a ceremony request must be the app's own origin (plan §6). The browser
 * sets it on every cross-site POST, so a request from another site cannot start or finish one.
 */
export function assertOrigin(origin: string | null): void {
  if (origin !== appOrigin()) throw new HttpError(403, "forbidden");
}

/** 32 random bytes, base64url: the `Session.id` and the cookie value (plan §3). */
export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

function sessionExpiry(at: Date): Date {
  return new Date(at.getTime() + SESSION_MAX_AGE_SECONDS * 1000);
}

/**
 * Starts registration from an invitation link. The invite is checked here so a dead link fails
 * before the passkey prompt. The user id is fixed now (the existing user's, or a fresh one) and
 * travels in the challenge row, so the passkey's user handle is the `User.id`.
 */
export async function startRegistration(
  inviteToken: string,
  deps: AuthDeps = {},
): Promise<CeremonyStart<PublicKeyCredentialCreationOptionsJSON>> {
  const { db } = resolve(deps);
  const invite = await loadInvite(inviteToken, deps);
  const existing = invite.forUserId
    ? await db.user.findUnique({ where: { id: invite.forUserId }, include: { passkeys: true } })
    : null;
  if (invite.forUserId && !existing) throw new HttpError(404, "not-found");
  const userId = existing?.id ?? randomUUID();

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId(),
    userID: new TextEncoder().encode(userId),
    userName: existing?.name ?? invite.name,
    userDisplayName: existing?.name ?? invite.name,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    excludeCredentials: (existing?.passkeys ?? []).map((p) => ({
      id: p.credentialId,
      ...(p.transports ? { transports: p.transports.split(",") } : {}),
    })),
  });
  const { id } = await createChallenge(
    { kind: "register", challenge: options.challenge, inviteToken, userId },
    deps,
  );
  return { challengeId: id, options };
}

/**
 * Verifies the attestation and, in one transaction, claims the invite, creates the user (unless
 * the invite names one), the membership with the invite's role, the passkey and the session.
 * `member.joined` or `device.added` is emitted after the commit.
 */
export async function finishRegistration(
  input: RegistrationInput,
  deps: AuthDeps = {},
): Promise<RegistrationResult> {
  const { db, emit, now } = resolve(deps);
  const challenge = await consumeChallenge(input.challengeId, "register", deps);
  if (!challenge.inviteToken || !challenge.userId) throw new HttpError(400, "validation");
  const invite = await loadInvite(challenge.inviteToken, deps);
  if (invite.forUserId && invite.forUserId !== challenge.userId) {
    throw new HttpError(400, "validation");
  }

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: appOrigin(),
      expectedRPID: rpId(),
      requireUserVerification: false,
    });
  } catch {
    throw new HttpError(403, "forbidden");
  }
  if (!verification.verified) throw new HttpError(403, "forbidden");
  const { credential } = verification.registrationInfo;

  const at = now();
  const sessionId = newSessionId();
  const expiresAt = sessionExpiry(at);
  const userId = challenge.userId;
  let role = invite.role as Role;

  const passkeyId = await transact(db, emit, async (tx, emitLater) => {
    const txDeps = { db: tx, emit: emitLater, now };
    await markInviteUsed(invite.token, txDeps);
    if (invite.forUserId) {
      // An add-a-device link changes no membership; the result carries the role the user has.
      const membership = await tx.membership.findUnique({
        where: { userId_spaceId: { userId, spaceId: invite.spaceId } },
      });
      if (!membership) throw new HttpError(404, "not-found");
      role = membership.role as Role;
    } else {
      await tx.user.create({ data: { id: userId, name: invite.name } });
      await addMember({ spaceId: invite.spaceId, userId, role }, txDeps);
    }
    const passkey = await tx.passkey.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports?.join(",") ?? null,
        deviceName: input.deviceName ?? null,
      },
    });
    if (invite.forUserId) {
      await emitDevice(tx, emitLater, "device.added", userId, passkey.id);
    }
    await tx.session.create({
      data: { id: sessionId, userId, passkeyId: passkey.id, expiresAt, lastSeenAt: at },
    });
    return passkey.id;
  });

  return { sessionId, expiresAt, userId, passkeyId, spaceId: invite.spaceId, role };
}

/** Starts a sign-in with a discoverable credential: no username, no `allowCredentials`. */
export async function startLogin(
  deps: AuthDeps = {},
): Promise<CeremonyStart<PublicKeyCredentialRequestOptionsJSON>> {
  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    userVerification: "preferred",
  });
  const { id } = await createChallenge({ kind: "login", challenge: options.challenge }, deps);
  return { challengeId: id, options };
}

/**
 * Verifies the assertion against the stored passkey, including the signature counter (a counter
 * that did not move is a cloned authenticator), then records the use and opens a session.
 * `lastSeen` here is sign-in bookkeeping and emits nothing.
 */
export async function finishLogin(input: LoginInput, deps: AuthDeps = {}): Promise<LoginResult> {
  const { db, emit, now } = resolve(deps);
  const challenge = await consumeChallenge(input.challengeId, "login", deps);
  const passkey = await db.passkey.findUnique({ where: { credentialId: input.response.id } });
  if (!passkey) throw new HttpError(403, "forbidden");

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: appOrigin(),
      expectedRPID: rpId(),
      credential: {
        id: passkey.credentialId,
        publicKey: passkey.publicKey,
        counter: passkey.counter,
        ...(passkey.transports ? { transports: passkey.transports.split(",") } : {}),
      },
      requireUserVerification: false,
    });
  } catch {
    throw new HttpError(403, "forbidden");
  }
  if (!verification.verified) throw new HttpError(403, "forbidden");

  const at = now();
  const sessionId = newSessionId();
  const expiresAt = sessionExpiry(at);
  await transact(db, emit, async (tx) => {
    // Conditional on the counter the assertion was verified against: a login that raced this
    // one on the same passkey has moved it, and neither a stale write nor a second session for
    // a cloned authenticator may follow.
    const { count } = await tx.passkey.updateMany({
      where: { id: passkey.id, counter: passkey.counter },
      data: { counter: verification.authenticationInfo.newCounter, lastUsedAt: at },
    });
    if (count !== 1) throw new HttpError(403, "forbidden");
    await tx.user.update({ where: { id: passkey.userId }, data: { lastSeen: at } });
    await tx.session.create({
      data: {
        id: sessionId,
        userId: passkey.userId,
        passkeyId: passkey.id,
        expiresAt,
        lastSeenAt: at,
      },
    });
  });
  return { sessionId, expiresAt, userId: passkey.userId };
}

/**
 * Deletes a passkey and every session it opened, so the next request from that device is
 * unauthenticated, and emits `device.removed` to each space the user belongs to. The caller
 * (the People route) has already checked the owner's role.
 */
export async function removePasskey(passkeyId: string, deps: AuthDeps = {}): Promise<void> {
  const { db, emit } = resolve(deps);
  const passkey = await db.passkey.findUnique({ where: { id: passkeyId } });
  if (!passkey) throw new HttpError(404, "not-found");
  await transact(db, emit, async (tx, emitLater) => {
    await tx.session.deleteMany({ where: { passkeyId } });
    await tx.passkey.delete({ where: { id: passkeyId } });
    await emitDevice(tx, emitLater, "device.removed", passkey.userId, passkeyId);
  });
}

/** Ends the current session. Unknown ids are already gone, so they succeed too. */
export async function logout(sessionId: string, deps: AuthDeps = {}): Promise<void> {
  const { db } = resolve(deps);
  await db.session.deleteMany({ where: { id: sessionId } });
}

/** A device event goes to every space the user is a member of; People shows devices per space. */
async function emitDevice(
  tx: AuthTx,
  emit: Emitter,
  type: "device.added" | "device.removed",
  userId: string,
  passkeyId: string,
): Promise<void> {
  const memberships = await tx.membership.findMany({ where: { userId } });
  for (const membership of memberships) {
    await emit(membership.spaceId, type, { userId, passkeyId });
  }
}
