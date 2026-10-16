import {
  ConnectSourceRequest,
  HttpError,
  log,
  prisma,
  type ConnectedSourceSettings,
} from "@frejsi/shared";

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
 * "Skift login" and "Vælg": an owner connects a glucose source. The credential goes to the
 * `source-connect` function, which probes it and writes it to Key Vault; this route saves the
 * `GlucoseSourceConfig` (`{ type, region, secretRef }`, `{ type, secretRef }` or `{ type }`) and
 * nothing else (decision 9): a Nightscout address or token is never stored, logged or echoed.
 * `manual` has nothing to connect to, so it is saved without a call. The route knows the config
 * shape and the connect contract, not any particular source.
 */
export const POST = settingsRoute<Params>(ROUTE, async (request, { spaceId }) => {
  await requireRole(spaceId, "owner");
  const body = await parseBody(request, ConnectSourceBody);
  const full = ConnectSourceRequest.safeParse({ ...body, spaceId });
  if (!full.success) {
    // Only the shape of the failure is looked at; the issues carry the input and are dropped.
    const onUrl = full.error.issues.some((issue) => issue.path[0] === "url");
    throw new HttpError(
      400,
      body.type === "nightscout" && onUrl ? "source-url-invalid" : "validation",
    );
  }
  const connect = full.data;

  if (connect.type === "manual") {
    const settings = await saveConnectedSource(spaceId, { type: "manual" });
    logOutcome("source.connected", ROUTE, "ok", { spaceId });
    return json(settings);
  }

  const outcome = await connectSource(connect);
  if (outcome.result === "bad-credentials") throw new HttpError(400, "source-bad-credentials");
  if (outcome.result === "unreachable") {
    // The cause (timeout, network, http-<status>, bad-body, ...) goes on its own line; the answer
    // to the owner stays the one designed "source-unreachable".
    log.warn("source.connect-unreachable", { route: ROUTE, code: outcome.cause, spaceId });
    throw new HttpError(503, "source-unreachable");
  }
  const settings = await saveConnectedSource(
    spaceId,
    connect.type === "dexcom-share"
      ? { type: "dexcom-share", region: connect.region, secretRef: outcome.secretRef }
      : { type: "nightscout", secretRef: outcome.secretRef },
  );
  logOutcome("source.connected", ROUTE, "ok", { spaceId });
  // The last day's reading count travels with the settings: zero is what the form warns about
  // (a follower's login, or sharing off); the function left it out when it could not read.
  const connected: ConnectedSourceSettings = {
    ...settings,
    ...(outcome.recentReadings === undefined ? {} : { recentReadings: outcome.recentReadings }),
  };
  return json(connected);
});
