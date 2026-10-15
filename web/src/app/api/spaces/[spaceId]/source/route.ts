import { HttpError, log, prisma } from "@frejsi/shared";

import { json, logOutcome, parseBody, settingsRoute } from "@/components/settings/api-route";
import { ConnectSourceBody } from "@/components/settings/contracts";
import { connectSource } from "@/components/settings/source-connect-client";
import { requireRole } from "@/lib/auth/session";

import {
  latestSourceStatusSince,
  saveConnectedSource,
  toSourceView,
} from "../settings/space-settings";

const ROUTE = "spaces.source";
interface Params {
  spaceId: string;
}

/** The configured source for owners and carers; a viewer is 403 here, in the API (plan task 9). */
export const GET = settingsRoute<Params>(ROUTE, async (_request, { spaceId }) => {
  await requireRole(spaceId, "owner", "carer");
  const row = await prisma.space.findUnique({ where: { id: spaceId } });
  if (!row) throw new HttpError(404, "not-found");
  return json(toSourceView(row, await latestSourceStatusSince(prisma, spaceId)));
});

/**
 * "Skift login": an owner connects a glucose source. The credential goes to the `source-connect`
 * function, which probes it and writes it to Key Vault; this route saves `{ type, region,
 * secretRef }` and nothing else (decision 9). The route knows the `GlucoseSourceConfig` shape and
 * the connect contract, not any particular source.
 */
export const POST = settingsRoute<Params>(ROUTE, async (request, { spaceId }) => {
  await requireRole(spaceId, "owner");
  const body = await parseBody(request, ConnectSourceBody);
  const outcome = await connectSource({ spaceId, ...body });
  if (outcome.result === "bad-credentials") throw new HttpError(400, "source-bad-credentials");
  if (outcome.result === "unreachable") {
    // The cause (timeout, network, http-<status>, bad-body, ...) goes on its own line; the answer
    // to the owner stays the one designed "source-unreachable".
    log.warn("source.connect-unreachable", { route: ROUTE, code: outcome.cause, spaceId });
    throw new HttpError(503, "source-unreachable");
  }
  const settings = await saveConnectedSource(spaceId, {
    type: body.type,
    region: body.region,
    secretRef: outcome.secretRef,
  });
  logOutcome("source.connected", ROUTE, "ok", { spaceId });
  return json(settings);
});
