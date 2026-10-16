import { pushEndpointAllowed } from "@frejsi/shared/push/endpoint";
import { cookies } from "next/headers";
import { HttpError, prisma } from "@frejsi/shared";
import { PushSubscriptionRequest } from "@frejsi/shared/schemas/ai";
import { json, parseBody, settingsRoute } from "@/components/settings/api-route";
import { requireRole, SESSION_COOKIE } from "@/lib/auth/session";
import { savePushSubscription } from "@/lib/push/store";

function handler(method: "POST" | "DELETE") {
  return settingsRoute("users.push-subscriptions", async (request) => {
    const input = await parseBody(request, PushSubscriptionRequest);
    const { session } = await requireRole(input.spaceId, "owner", "carer");
    if (!pushEndpointAllowed(input.subscription.endpoint)) throw new HttpError(400, "validation");
    if (!process.env.VAPID_PRIVATE_KEY) throw new HttpError(503, "push-not-configured");
    const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!sessionId) throw new HttpError(403, "forbidden");
    await savePushSubscription(method, session.userId, sessionId, input);
    return json({ ok: true });
  });
}
export const POST = handler("POST");
export const DELETE = handler("DELETE");

export const GET = settingsRoute("users.push-subscriptions", async (request) => {
  const spaceId = new URL(request.url).searchParams.get("spaceId");
  if (!spaceId) throw new HttpError(400, "validation");
  const { session } = await requireRole(spaceId, "owner", "carer");
  if (!process.env.VAPID_PRIVATE_KEY) throw new HttpError(503, "push-not-configured");
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionId) throw new HttpError(403, "forbidden");
  const row = await prisma.pushSubscription.findFirst({
    where: { spaceId, userId: session.userId, sessionId },
    select: { id: true },
  });
  return json({ subscribed: !!row });
});
