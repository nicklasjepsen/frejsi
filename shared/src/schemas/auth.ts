import { z } from "zod";

import { Accent, Locale } from "./settings";

export const Role = z.enum(["owner", "carer", "viewer"]);
export type Role = z.infer<typeof Role>;

/** What `getSession()` returns and what layouts and routes read (plan §4, §6). */
export const SessionContext = z.object({
  userId: z.string().min(1),
  name: z.string(),
  simpleMode: z.boolean(),
  accent: Accent,
  locale: Locale,
  memberships: z.array(z.object({ spaceId: z.string().min(1), role: Role })),
});
export type SessionContext = z.infer<typeof SessionContext>;

/** What the invite landing page gets; never the token itself. */
export const InviteView = z.object({
  name: z.string(),
  spaceName: z.string(),
  role: Role,
  inviterName: z.string(),
  daysLeft: z.number().int().min(0),
  forExistingUser: z.boolean(),
});
export type InviteView = z.infer<typeof InviteView>;
