import { HttpError, Role } from "@frejsi/shared";
import { z } from "zod";

import { route } from "@/app/api/auth/http";
import { groupsFor, SPACE_QUERY } from "@/lib/live/contracts";
import { json, liveDeps, log } from "@/lib/live/server";
import { originAllowed, signatureValid } from "@/lib/live/upstream";

const ROUTE = "pubsub.connect";
const CONNECT_TYPE = "azure.webpubsub.sys.connect";

/** The part of the connect event's body the handler reads: the socket URL's query, as forwarded. */
const ConnectBody = z.object({
  query: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
});

/**
 * CloudEvents abuse protection (Web PubSub "webhook validation"): the service asks once whether
 * it may deliver events here, and is allowed only when it is this app's own Web PubSub.
 */
export function OPTIONS(request: Request): Promise<Response> {
  const { upstream } = liveDeps();
  const origin = request.headers.get("webhook-request-origin");
  if (!upstream || !originAllowed(origin, upstream)) {
    log.warn("live.upstream-refused", { route: ROUTE, code: 403 });
    return Promise.resolve(new Response(null, { status: 403 }));
  }
  return Promise.resolve(
    new Response(null, { status: 200, headers: { "WebHook-Allowed-Origin": upstream.origin } }),
  );
}

/**
 * The hub's `connect` event (issue #95). Client tokens carry no groups; this decides them, from
 * the membership the user has at the moment the socket connects: `space-<id>` for any member,
 * `space-<id>-glucose` for owners and carers only. A non-member, a removed member or a request the
 * service did not sign is refused, and the service then refuses the socket. Any failure fails
 * closed: no 2xx, no groups.
 */
export const POST = route(ROUTE, async (request) => {
  const { db, upstream } = liveDeps();
  if (!upstream) throw new HttpError(503, "internal");
  const headers = request.headers;
  if (!originAllowed(headers.get("webhook-request-origin"), upstream)) {
    throw new HttpError(403, "forbidden");
  }
  if (
    !signatureValid(
      headers.get("ce-signature"),
      headers.get("ce-connectionid"),
      upstream.accessKeys,
    )
  ) {
    throw new HttpError(401, "forbidden");
  }
  if ((headers.get("ce-hub") ?? "").toLowerCase() !== upstream.hub) {
    throw new HttpError(400, "validation");
  }
  if (headers.get("ce-type") !== CONNECT_TYPE) throw new HttpError(400, "validation");
  const userId = headers.get("ce-userid");
  if (!userId) throw new HttpError(401, "forbidden");

  const spaceId = spaceOf(await request.json().catch(() => null));
  const membership = await db.membership.findUnique({
    where: { userId_spaceId: { userId, spaceId } },
    select: { role: true },
  });
  const role = Role.safeParse(membership?.role);
  if (!role.success) {
    log.warn("live.connect-refused", { route: ROUTE, spaceId, userId, code: 403 });
    throw new HttpError(403, "forbidden");
  }
  const groups = groupsFor(spaceId, role.data);
  log.info("live.connect", { route: ROUTE, spaceId, userId, count: groups.length });
  return json({ groups });
});

/** The one non-empty `spaceId` in the forwarded query; anything else is a 400. */
function spaceOf(body: unknown): string {
  const parsed = ConnectBody.safeParse(body);
  if (!parsed.success) throw new HttpError(400, "validation");
  const raw = parsed.data.query?.[SPACE_QUERY];
  const values = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const [spaceId] = values;
  if (values.length !== 1 || !spaceId) throw new HttpError(400, "validation");
  return spaceId;
}
