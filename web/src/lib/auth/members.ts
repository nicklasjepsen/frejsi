// The only module that creates or changes memberships (plan task 5). Registration, the People
// routes and the seed call these; nothing else writes the Membership table.
import { HttpError, type Role } from "@frejsi/shared";

import { run, type AuthDeps, type AuthTx, type TxDeps } from "./core";

export interface MemberRef {
  spaceId: string;
  userId: string;
}

export interface NewMember extends MemberRef {
  role: Role;
}

/** Adds a member and emits `member.joined`, in the registration or bootstrap transaction or its own. */
export function addMember(input: NewMember, deps: AuthDeps | TxDeps = {}): Promise<void> {
  return run(deps, async (db, emit) => {
    await db.membership.create({
      data: { userId: input.userId, spaceId: input.spaceId, role: input.role },
    });
    await emit(input.spaceId, "member.joined", { userId: input.userId, role: input.role });
  });
}

/**
 * Changes a member's role and emits `member.updated`. The last owner cannot step down; the count
 * and the write share a serializable transaction so two owners cannot both step down at once.
 */
export function changeMemberRole(input: NewMember, deps: AuthDeps = {}): Promise<void> {
  return run(
    deps,
    async (tx, emit) => {
      const current = await membership(tx, input);
      if (current.role === "owner" && input.role !== "owner") await assertNotLastOwner(tx, input);
      await tx.membership.update({
        where: { userId_spaceId: { userId: input.userId, spaceId: input.spaceId } },
        data: { role: input.role },
      });
      await emit(input.spaceId, "member.updated", { userId: input.userId, role: input.role });
    },
    { serializable: true },
  );
}

/**
 * Removes a member and emits `member.removed`; their next request for the space is 404 because
 * `requireRole` no longer finds a membership. The last owner cannot be removed.
 */
export function removeMember(input: MemberRef, deps: AuthDeps = {}): Promise<void> {
  return run(
    deps,
    async (tx, emit) => {
      const current = await membership(tx, input);
      if (current.role === "owner") await assertNotLastOwner(tx, input);
      await tx.membership.delete({
        where: { userId_spaceId: { userId: input.userId, spaceId: input.spaceId } },
      });
      await emit(input.spaceId, "member.removed", { userId: input.userId });
    },
    { serializable: true },
  );
}

async function membership(tx: AuthTx, ref: MemberRef) {
  const row = await tx.membership.findUnique({
    where: { userId_spaceId: { userId: ref.userId, spaceId: ref.spaceId } },
  });
  if (!row) throw new HttpError(404, "not-found");
  return row;
}

async function assertNotLastOwner(tx: AuthTx, ref: MemberRef): Promise<void> {
  const owners = await tx.membership.count({ where: { spaceId: ref.spaceId, role: "owner" } });
  if (owners <= 1) throw new HttpError(409, "last-owner");
}
