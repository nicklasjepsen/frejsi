import { z } from "zod";

import { Role } from "./auth";
import { Reading, SourceStatus } from "./glucose";

/** Later milestones append `meal.*` and `food.*` here; never reorder. */
export const EventType = z.enum([
  "reading",
  "source.status",
  "space.updated",
  "member.joined",
  "member.updated",
  "member.removed",
  "invite.created",
  "invite.revoked",
  "device.added",
  "device.removed",
]);
export type EventType = z.infer<typeof EventType>;

export const SourceStatusPayload = z.object({ status: SourceStatus, since: z.iso.datetime() });
/** Space columns only; a User column change is `member.updated` to every space of that user. */
export const SpaceUpdatedPayload = z.object({ fields: z.array(z.string()) });
export const MemberPayload = z.object({ userId: z.string().min(1), role: Role.optional() });
/** The token never travels in an event; only its hash. */
export const InvitePayload = z.object({
  tokenHash: z.string().min(1),
  role: Role,
  name: z.string(),
  forUserId: z.string().min(1).optional(),
});
export const DevicePayload = z.object({ userId: z.string().min(1), passkeyId: z.string().min(1) });

/** One payload schema per type. `emit()` validates against this map before it writes. */
export const EventPayloads = {
  reading: Reading,
  "source.status": SourceStatusPayload,
  "space.updated": SpaceUpdatedPayload,
  "member.joined": MemberPayload,
  "member.updated": MemberPayload,
  "member.removed": MemberPayload,
  "invite.created": InvitePayload,
  "invite.revoked": InvitePayload,
  "device.added": DevicePayload,
  "device.removed": DevicePayload,
} as const satisfies Record<EventType, z.ZodType>;

export type EventPayload<T extends EventType> = z.infer<(typeof EventPayloads)[T]>;

const envelope = <T extends EventType>(type: T) =>
  z.object({
    spaceId: z.string().min(1),
    seq: z.number().int().positive(),
    ts: z.iso.datetime(),
    type: z.literal(type),
    payload: EventPayloads[type],
  });

/** The live feed row and the Web PubSub message, discriminated on `type` (plan §4, §5). */
export const EventEnvelope = z.discriminatedUnion("type", [
  envelope("reading"),
  envelope("source.status"),
  envelope("space.updated"),
  envelope("member.joined"),
  envelope("member.updated"),
  envelope("member.removed"),
  envelope("invite.created"),
  envelope("invite.revoked"),
  envelope("device.added"),
  envelope("device.removed"),
]);
export type EventEnvelope = z.infer<typeof EventEnvelope>;
export type EventEnvelopeOf<T extends EventType> = Extract<EventEnvelope, { type: T }>;
