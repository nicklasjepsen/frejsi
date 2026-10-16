import {
  createEmit,
  createEventSinkFromEnv,
  prisma,
  type EventEnvelope,
  type EventSink,
  type PrismaClient,
} from "@frejsi/shared";
import type { PushSubscriptionRequest } from "@frejsi/shared/schemas/ai";

/** Subscription changes and their event commit together; only delivery bookkeeping skips emit. */
export async function savePushSubscription(
  method: "POST" | "DELETE",
  userId: string,
  sessionId: string,
  input: PushSubscriptionRequest,
  db: PrismaClient = prisma,
  sink: EventSink = createEventSinkFromEnv(),
): Promise<void> {
  const queued: { group: string; envelope: EventEnvelope }[] = [];
  await db.$transaction(async (tx) => {
    const { spaceId, subscription } = input;
    const { endpoint, keys } = subscription;
    if (method === "POST") {
      const data = {
        userId,
        spaceId,
        sessionId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        failures: 0,
      };
      await tx.pushSubscription.upsert({
        where: { userId_endpoint: { userId, endpoint } },
        create: data,
        update: data,
      });
    } else {
      await tx.pushSubscription.deleteMany({ where: { userId, sessionId, spaceId, endpoint } });
    }
    const emit = createEmit({
      db: { $transaction: (run) => run(tx) },
      sink: {
        publish: (group, envelope) => {
          queued.push({ group, envelope });
          return Promise.resolve();
        },
      },
    });
    await emit(spaceId, method === "POST" ? "push.subscribed" : "push.unsubscribed", {
      userId,
      spaceId,
    });
  });
  // Publish after commit. A transport failure cannot undo a saved subscription.
  await Promise.allSettled(queued.map(({ group, envelope }) => sink.publish(group, envelope)));
}
