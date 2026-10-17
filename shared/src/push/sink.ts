import webPush from "web-push";
import { pushEndpointAllowed } from "./endpoint";
import type { EventEnvelope } from "../schemas/events";
import type { SpaceSymptomKind } from "../schemas/symptom";
import type { EventSink } from "../events/types";
import { log } from "../log";
import { symptomKindLabel } from "../symptoms/kinds";
import da from "./messages/da.json";
import en from "./messages/en.json";

export interface NotificationPayload {
  title: string;
  body: string;
  data: { url: string };
}
export interface PushRecipient {
  id: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  locale: "da" | "en";
}
/** Who logged a symptom, as far as the push needs to know: a name, the mode and the space's clock. */
export interface SymptomLogger {
  child: string;
  simpleMode: boolean;
  timezone: string;
  symptomKinds: SpaceSymptomKind[];
}
export interface PushRepository {
  asked(
    spaceId: string,
    foodId: string,
    byUserId: string,
  ): Promise<{ child: string; dishName: string; carbs: number } | null>;
  /** Null when the logger is not an owner or carer of the space. */
  symptomLogger(spaceId: string, byUserId: string): Promise<SymptomLogger | null>;
  recipients(spaceId: string, excludeUserId: string): Promise<PushRecipient[]>;
  remove(id: string): Promise<void>;
  failed(id: string): Promise<void>;
}
export type PushSender = (recipient: PushRecipient, payload: NotificationPayload) => Promise<void>;

interface Copy {
  title: string;
  body: string;
}
function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
/** `YYYY-MM-DD` and `HH:MM` of an instant in the space's zone, for the link and the body. */
function localDateTime(ts: string, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ts));
  const p = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${p("year")}-${p("month")}-${p("day")}`, time: `${p("hour")}:${p("minute")}` };
}

export class WebPushSink implements EventSink {
  constructor(
    private readonly repository: PushRepository,
    private readonly send: PushSender,
    private readonly write: (fields: { count: number; code: string }) => void = (fields) => {
      log.info("push.delivery", fields);
    },
  ) {}
  async publish(_group: string, event: EventEnvelope): Promise<void> {
    if (event.type === "estimate.asked") return this.asked(event);
    if (event.type === "symptom.created") return this.symptom(event);
  }
  private async asked(event: EventEnvelope & { type: "estimate.asked" }): Promise<void> {
    const { foodId, byUserId } = event.payload;
    const asked = await this.repository.asked(event.spaceId, foodId, byUserId);
    if (!asked) return;
    await this.deliver(event.spaceId, byUserId, (locale) => {
      const copy: Copy = (locale === "en" ? en : da).estimate;
      return {
        title: fill(copy.title, asked),
        body: fill(copy.body, asked),
        data: { url: `/${locale}/library/${encodeURIComponent(foodId)}` },
      };
    });
  }
  /**
   * A symptom logged by a simpleMode member reaches the adults like "Spørg en voksen" does
   * (decision 8). An adult's own entry tells nobody: the other parent sees it on the curve.
   */
  private async symptom(event: EventEnvelope & { type: "symptom.created" }): Promise<void> {
    const { byUserId, kind, ts } = event.payload;
    const logger = await this.repository.symptomLogger(event.spaceId, byUserId);
    if (!logger?.simpleMode) return;
    const { date, time } = localDateTime(ts, logger.timezone);
    await this.deliver(event.spaceId, byUserId, (locale) => {
      const copy: Copy = (locale === "en" ? en : da).symptom;
      const values = {
        child: logger.child,
        kind: symptomKindLabel(kind, locale, logger.symptomKinds),
        time,
      };
      return {
        title: fill(copy.title, values),
        body: fill(copy.body, values),
        data: { url: `/${locale}/history?date=${date}` },
      };
    });
  }
  private async deliver(
    spaceId: string,
    excludeUserId: string,
    payloadFor: (locale: PushRecipient["locale"]) => NotificationPayload,
  ): Promise<void> {
    const recipients = await this.repository.recipients(spaceId, excludeUserId);
    let count = 0;
    for (const recipient of recipients) {
      try {
        await this.send(recipient, payloadFor(recipient.locale));
        count++;
      } catch (error) {
        const status =
          typeof error === "object" && error !== null && "statusCode" in error
            ? error.statusCode
            : undefined;
        try {
          if (status === 404 || status === 410) await this.repository.remove(recipient.id);
          else await this.repository.failed(recipient.id);
        } catch {
          this.write({ count: 1, code: "push-bookkeeping-failed" });
        }
        this.write({
          count: 1,
          code: status === 404 || status === 410 ? "push-expired" : "push-failed",
        });
      }
    }
    this.write({ count, code: "push-sent" });
  }
}
/** Per-call VAPID details avoid mutable vendor globals. No provider response is logged. */
export function webPushSender(vapidDetails: {
  subject: string;
  publicKey: string;
  privateKey: string;
}): PushSender {
  return async (recipient, payload) => {
    if (!pushEndpointAllowed(recipient.endpoint)) throw new Error("Unsupported push endpoint");
    await webPush.sendNotification(
      { endpoint: recipient.endpoint, keys: recipient.keys },
      JSON.stringify(payload),
      {
        vapidDetails,
        timeout: 5000,
        TTL: 3600,
      },
    );
  };
}
