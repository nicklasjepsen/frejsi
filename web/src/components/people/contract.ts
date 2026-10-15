// The People contract between the routes under /api/spaces/[spaceId]/{members,invites,passkeys}
// and the screen (plan task 7). Web-only: the poller and the AI never see these shapes, so they
// live next to the components rather than in @frejsi/shared. There is no glucose field in here
// and no schema for one: a viewer may read the members list (CLAUDE.md, spec §2).
//
// The Zod schemas come from their own module, not the @frejsi/shared barrel: this file is
// bundled for the browser, and the barrel also exports Prisma and the Azure clients.
import { Role } from "@frejsi/shared/schemas/auth";
import { z } from "zod";

/** One passkey of a member, as People shows it. Never the credential or the public key. */
export const DeviceView = z.object({
  id: z.string().min(1),
  /** What the person called the device at registration; null when they did not. */
  name: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type DeviceView = z.infer<typeof DeviceView>;

export const MemberView = z.object({
  userId: z.string().min(1),
  name: z.string(),
  role: Role,
  simpleMode: z.boolean(),
  /** `User.lastSeen`, touched by sign-in and at most hourly by a request (plan §6). */
  lastSeen: z.iso.datetime().nullable(),
  devices: z.array(DeviceView),
});
export type MemberView = z.infer<typeof MemberView>;

/**
 * A pending invitation. The token itself leaves the server only once, to the owner who created
 * it; here the row is named by the token's hash, the same id the `invite.*` events carry.
 */
export const PendingInviteView = z.object({
  id: z.string().min(1),
  name: z.string(),
  role: Role,
  /** Set for an add-a-device link to an existing member (spec §2b). */
  forUserId: z.string().min(1).optional(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type PendingInviteView = z.infer<typeof PendingInviteView>;

/** `GET /api/spaces/:id/members` and what the page renders. */
export const PeopleView = z.object({
  members: z.array(MemberView),
  invites: z.array(PendingInviteView),
});
export type PeopleView = z.infer<typeof PeopleView>;

/** `POST /api/spaces/:id/invites`: a new person, or a new device for a member (`forUserId`). */
export const CreateInviteBody = z.union([
  z.object({ name: z.string().trim().min(1).max(80), role: Role }),
  z.object({ forUserId: z.string().min(1) }),
]);
export type CreateInviteBody = z.infer<typeof CreateInviteBody>;

/**
 * How long an invitation link is good for, as the validity line says it. The auth core owns the
 * TTL (`INVITE_TTL_MS`); contract.test.ts holds the two together, since this file is bundled for
 * the browser and cannot import the server module.
 */
export const INVITE_VALID_DAYS = 7;

/** What the owner gets back, once: the link to share, and when it dies. */
export const CreatedInviteView = z.object({
  id: z.string().min(1),
  url: z.url(),
  name: z.string(),
  role: Role,
  forUserId: z.string().min(1).optional(),
  expiresAt: z.iso.datetime(),
});
export type CreatedInviteView = z.infer<typeof CreatedInviteView>;

/** `PATCH /api/spaces/:id/members/:userId`. */
export const ChangeRoleBody = z.object({ role: Role });
export type ChangeRoleBody = z.infer<typeof ChangeRoleBody>;
