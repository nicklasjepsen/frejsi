// Imported by the browser feed: schemas only, never the shared barrel, which carries Prisma and
// App Insights that no client bundle can resolve (client-imports.test.ts).
import {
  EventEnvelope,
  GlucoseSourceType,
  GlucoseUnit,
  Reading,
  type Role,
  SourceStatus,
} from "@frejsi/shared/schemas/index";
import { z } from "zod";

/** The longest readings window a client may ask for (`readings?hours=1..24`, plan §5). */
export const MAX_WINDOW_HOURS = 24;
export const DEFAULT_WINDOW_HOURS = 24;
/** The most events one `events?since` page carries; a longer gap takes several pages. */
export const EVENTS_PAGE_SIZE = 1000;

/** The Web PubSub groups a member may join: readings go to the glucose group viewers never get. */
export function groupsFor(spaceId: string, role: Role): string[] {
  const groups = [`space-${spaceId}`];
  if (role !== "viewer") groups.push(`space-${spaceId}-glucose`);
  return groups;
}

export const WindowHours = z.coerce.number().int().min(1).max(MAX_WINDOW_HOURS);
export const SinceSeq = z.coerce.number().int().min(0);

/** The space columns the Now screen renders by; `space.updated` makes the client fetch them again. */
export const LiveSpace = z.object({
  glucoseUnit: GlucoseUnit,
  /** Always in mmol/L (plan §3). */
  targetLow: z.number(),
  targetHigh: z.number(),
  timezone: z.string().min(1),
  sourceType: GlucoseSourceType.nullable(),
});
export type LiveSpace = z.infer<typeof LiveSpace>;

/**
 * `GET /api/spaces/:id/readings?hours=`: the readings window and the sequence cursor it is
 * consistent with, so that `events?since=lastSeq` continues without a gap. Owners and carers only.
 */
export const ReadingsWindow = z.object({
  lastSeq: z.number().int().min(0),
  sourceStatus: SourceStatus,
  /** The `since` of the latest `source.status` event, or null when there has been none. */
  sourceSince: z.iso.datetime().nullable(),
  space: LiveSpace,
  readings: z.array(Reading),
});
export type ReadingsWindow = z.infer<typeof ReadingsWindow>;

/** `GET /api/spaces/:id/events?since=`: the events after `since` in order, role-filtered. */
export const EventsPage = z.object({
  /** The highest sequence the page reached, filtered rows included; the next `since`. */
  lastSeq: z.number().int().min(0),
  events: z.array(EventEnvelope),
  /** True when the page was full and another `events?since=lastSeq` call is needed. */
  more: z.boolean(),
});
export type EventsPage = z.infer<typeof EventsPage>;

/** `GET /api/spaces/:id/negotiate`: the socket URL with the token in its query string. */
export const NegotiateResult = z.object({ url: z.string().min(1) });
export type NegotiateResult = z.infer<typeof NegotiateResult>;
