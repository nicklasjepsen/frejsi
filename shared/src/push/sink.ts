import webPush from "web-push";
import { pushEndpointAllowed } from "./endpoint";
import type { EventEnvelope } from "../schemas/events";
import type { EventSink } from "../events/types";
import { log } from "../log";
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
export interface PushRepository {
  asked(
    spaceId: string,
    foodId: string,
    byUserId: string,
  ): Promise<{ child: string; dishName: string; carbs: number } | null>;
  recipients(spaceId: string, excludeUserId: string): Promise<PushRecipient[]>;
  remove(id: string): Promise<void>;
  failed(id: string): Promise<void>;
}
export type PushSender = (recipient: PushRecipient, payload: NotificationPayload) => Promise<void>;
export class WebPushSink implements EventSink {
  constructor(
    private readonly repository: PushRepository,
    private readonly send: PushSender,
    private readonly write: (fields: { count: number; code: string }) => void = (fields) => {
      log.info("push.delivery", fields);
    },
  ) {}
  async publish(_group: string, event: EventEnvelope): Promise<void> {
    if (event.type !== "estimate.asked") return;
    const { foodId, byUserId } = event.payload;
    const asked = await this.repository.asked(event.spaceId, foodId, byUserId);
    if (!asked) return;
    const recipients = await this.repository.recipients(event.spaceId, byUserId);
    let count = 0;
    for (const recipient of recipients) {
      const messages = recipient.locale === "en" ? en : da;
      const fill = (text: string) =>
        text.replace(/\{(child|dishName|carbs)\}/g, (_, key: keyof typeof asked) =>
          String(asked[key]),
        );
      const payload: NotificationPayload = {
        title: fill(messages.title),
        body: fill(messages.body),
        data: { url: `/${recipient.locale}/library/${encodeURIComponent(foodId)}` },
      };
      try {
        await this.send(recipient, payload);
        count++;
      } catch (error) {
        const status =
          typeof error === "object" && error !== null && "statusCode" in error
            ? error.statusCode
            : undefined;
        if (status === 404 || status === 410) await this.repository.remove(recipient.id);
        else await this.repository.failed(recipient.id);
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
