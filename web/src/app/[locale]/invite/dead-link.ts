/**
 * The states of a link that exists but cannot be used, as `loadInvite` names them; the landing
 * page has a line for each. Kept apart from `invite-view.ts` so the client component that
 * renders them imports no database.
 */
export const DEAD_INVITE_CODES = ["invite-used", "invite-revoked", "invite-expired"] as const;
export type DeadInviteCode = (typeof DEAD_INVITE_CODES)[number];

export function isDeadInviteCode(code: string): code is DeadInviteCode {
  return (DEAD_INVITE_CODES as readonly string[]).includes(code);
}
