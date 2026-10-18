import { z } from "zod";

import { Role } from "./auth";
import { Reading, SourceStatus } from "./glucose";
import { FoodOrigin } from "./food";
import { SymptomKind } from "./symptom";

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
  "food.created",
  "food.updated",
  "food.verified",
  "food.deleted",
  "meal.created",
  "meal.updated",
  "meal.deleted",
  "readings.imported",
  "insight.created",
  "insight.updated",
  "estimate.asked",
  "push.subscribed",
  "push.unsubscribed",
  "food.contributed",
  "symptom.created",
  "symptom.updated",
  "symptom.deleted",
  "pump.imported",
  "pump.meals",
  "pump.status",
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
export const FoodCreatedPayload = z.strictObject({ foodId: z.string().min(1), origin: FoodOrigin });
export const FoodIdPayload = z.strictObject({ foodId: z.string().min(1) });
export const FoodVerifiedPayload = z.strictObject({
  foodId: z.string().min(1),
  verifiedBy: z.string().min(1),
});
/** A correction was sent to the source it came from. Ids only: no values, no name, no glucose. */
export const FoodContributedPayload = z.strictObject({
  foodId: z.string().min(1),
  source: FoodOrigin,
});
export const MealCreatedPayload = z.strictObject({
  mealId: z.string().min(1),
  ts: z.iso.datetime(),
  totalCarbs: z.number().int().nonnegative(),
});
export const MealIdPayload = z.strictObject({ mealId: z.string().min(1) });
/**
 * One event per import batch, never one per imported reading: a batch of a month is thousands of
 * rows, and the clients only need to know the window changed. Counts and the range only; it
 * travels in the glucose group like `reading`, so a viewer never hears it.
 */
export const ReadingsImportedPayload = z.strictObject({
  count: z.number().int().nonnegative(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
});

export const InsightCreatedPayload = z.strictObject({
  insightId: z.string().min(1),
  kind: z.enum(["meal", "week"]),
  subjectKey: z.string().min(1).max(40),
});
export const InsightIdPayload = z.strictObject({ insightId: z.string().min(1) });
export const EstimateAskedPayload = z.strictObject({
  foodId: z.string().min(1),
  byUserId: z.string().min(1),
});
export const PushSubscriptionPayload = z.strictObject({
  userId: z.string().min(1),
  spaceId: z.string().min(1),
});
/**
 * A symptom was logged (v0.6.0 plan §4): the id, the time, the kind and who. Never the note or the
 * severity, and nothing of glucose, so it travels to every member, viewers included.
 */
export const SymptomCreatedPayload = z.strictObject({
  symptomId: z.string().min(1),
  ts: z.iso.datetime(),
  kind: SymptomKind,
  byUserId: z.string().min(1),
});
export const SymptomIdPayload = z.strictObject({ symptomId: z.string().min(1) });
/**
 * The pump record (v0.7.0 plan §4). All three travel in the glucose group, so a viewer never hears
 * when pump data arrives. `pump.imported`: one per space per cycle that stored anything, counts and
 * the range only. `pump.meals`: every meal change the pump caused (a link set or cleared, a pump
 * meal made or removed), ids only; a pump meal never emits `meal.created`. `pump.status`: the
 * connection, like `source.status`.
 */
export const PumpImportedPayload = z.strictObject({
  count: z.number().int().nonnegative(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
});
const mealIds = z.array(z.string().min(1));
export const PumpMealsPayload = z.strictObject({
  updated: mealIds,
  created: mealIds,
  removed: mealIds,
});
export const PumpStatusPayload = z.strictObject({ status: SourceStatus, since: z.iso.datetime() });

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
  "food.created": FoodCreatedPayload,
  "food.updated": FoodIdPayload,
  "food.verified": FoodVerifiedPayload,
  "food.deleted": FoodIdPayload,
  "meal.created": MealCreatedPayload,
  "meal.updated": MealIdPayload,
  "meal.deleted": MealIdPayload,
  "readings.imported": ReadingsImportedPayload,
  "insight.created": InsightCreatedPayload,
  "insight.updated": InsightIdPayload,
  "estimate.asked": EstimateAskedPayload,
  "push.subscribed": PushSubscriptionPayload,
  "push.unsubscribed": PushSubscriptionPayload,
  "food.contributed": FoodContributedPayload,
  "symptom.created": SymptomCreatedPayload,
  "symptom.updated": SymptomIdPayload,
  "symptom.deleted": SymptomIdPayload,
  "pump.imported": PumpImportedPayload,
  "pump.meals": PumpMealsPayload,
  "pump.status": PumpStatusPayload,
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
  envelope("food.created"),
  envelope("food.updated"),
  envelope("food.verified"),
  envelope("food.deleted"),
  envelope("meal.created"),
  envelope("meal.updated"),
  envelope("meal.deleted"),
  envelope("readings.imported"),
  envelope("insight.created"),
  envelope("insight.updated"),
  envelope("estimate.asked"),
  envelope("push.subscribed"),
  envelope("push.unsubscribed"),
  envelope("food.contributed"),
  envelope("symptom.created"),
  envelope("symptom.updated"),
  envelope("symptom.deleted"),
  envelope("pump.imported"),
  envelope("pump.meals"),
  envelope("pump.status"),
]);
export type EventEnvelope = z.infer<typeof EventEnvelope>;
export type EventEnvelopeOf<T extends EventType> = Extract<EventEnvelope, { type: T }>;

/**
 * The event types that carry or concern glucose: published to the glucose group a viewer cannot
 * join, and filtered out of a viewer's events page in the query (CLAUDE.md hard rules). The pump
 * record is glucose-side data (v0.7.0): a viewer never learns that it exists.
 */
export const GLUCOSE_EVENT_TYPES: readonly EventType[] = [
  "reading",
  "readings.imported",
  "pump.imported",
  "pump.meals",
  "pump.status",
];
export const isGlucoseEvent = (type: EventType): boolean => GLUCOSE_EVENT_TYPES.includes(type);
