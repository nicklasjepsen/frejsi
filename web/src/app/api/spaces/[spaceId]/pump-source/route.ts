import {
  ConnectPumpRequest,
  HttpError,
  log,
  parseSecretRef,
  prisma,
  pumpSecretName,
} from "@frejsi/shared";

import { json, logOutcome, parseBody, settingsRoute } from "@/components/settings/api-route";
import {
  PumpSourceBody,
  type ConnectedPumpSettings,
} from "@/components/settings/pump-source-client";
import { requireRole } from "@/lib/auth/session";
import type { Role } from "@frejsi/shared";

import { connectPump } from "./connect-pump";
import {
  clearPumpSource,
  latestPumpStatusSince,
  savePumpSource,
  toPumpSettingsView,
} from "./pump-settings";

const ROUTE = "spaces.pump-source";
interface Params {
  spaceId: string;
}

/**
 * The role and the mode, judged here and before anything is read (spec §3, CLAUDE.md hard rules):
 * the pump record is for owners and carers outside simpleMode, never a viewer, so a viewer and a
 * simpleMode session are 403 in the API, whatever the screens show.
 */
async function requirePumpRole(spaceId: string, ...roles: Role[]) {
  const access = await requireRole(spaceId, ...roles);
  if (access.session.simpleMode) throw new HttpError(403, "forbidden");
  return access;
}

/** Whether the function answered a reference to this space's pump secret, versioned or not. */
function isPumpSecretOf(secretRef: string, spaceId: string): boolean {
  try {
    return parseSecretRef(secretRef).name === pumpSecretName(spaceId);
  } catch {
    return false;
  }
}

/** The card's state for owners and carers: status, since, the newest record, configured. */
export const GET = settingsRoute<Params>(ROUTE, async (_request, { spaceId }) => {
  await requirePumpRole(spaceId, "owner", "carer");
  const row = await prisma.space.findUnique({ where: { id: spaceId } });
  if (!row) throw new HttpError(404, "not-found");
  return json(toPumpSettingsView(row, await latestPumpStatusSince(prisma, spaceId)));
});

/**
 * "Forbind": an owner connects the pump record (plan §5, decision 2). The address and the token go
 * to `source-connect` with `purpose: "pump"`, which probes them and writes `pump-<spaceId>` in Key
 * Vault; this route saves `{ type, secretRef, connectedBy }` and nothing else. The address and the
 * token are never stored, logged or echoed.
 */
export const POST = settingsRoute<Params>(ROUTE, async (request, { spaceId }) => {
  const { session } = await requirePumpRole(spaceId, "owner");
  const body = await parseBody(request, PumpSourceBody);
  const full = ConnectPumpRequest.safeParse({ purpose: "pump", ...body, spaceId });
  if (!full.success) {
    // Only the shape of the failure is looked at; the issues carry the input and are dropped.
    const onUrl = full.error.issues.some((issue) => issue.path[0] === "url");
    throw new HttpError(400, onUrl ? "source-url-invalid" : "validation");
  }

  const outcome = await connectPump(full.data);
  if (outcome.result === "bad-credentials") throw new HttpError(400, "source-bad-credentials");
  if (outcome.result === "unreachable") {
    log.warn("pump.connect-unreachable", { route: ROUTE, code: outcome.cause, spaceId });
    throw new HttpError(503, "source-unreachable");
  }
  // A reference to any other secret (the glucose one above all) is never saved as the pump's.
  if (!isPumpSecretOf(outcome.secretRef, spaceId)) {
    log.warn("pump.connect-unreachable", { route: ROUTE, code: "bad-body", spaceId });
    throw new HttpError(503, "source-unreachable");
  }

  const view = await savePumpSource(spaceId, {
    type: "nightscout",
    secretRef: outcome.secretRef,
    connectedBy: session.userId,
  });
  logOutcome("pump.connected", ROUTE, "ok", { spaceId });
  // Zero boluses in the last day with a working token is the card's warning (the upload from the
  // pump is not running, or it is the wrong site); left out when the function could not tell.
  const connected: ConnectedPumpSettings = {
    ...view,
    ...(outcome.recentBoluses === undefined ? {} : { recentBoluses: outcome.recentBoluses }),
  };
  return json(connected);
});

/** "Afbryd": an owner stops the pump record; what was imported stays. */
export const DELETE = settingsRoute<Params>(ROUTE, async (_request, { spaceId }) => {
  await requirePumpRole(spaceId, "owner");
  const view = await clearPumpSource(spaceId);
  logOutcome("pump.disconnected", ROUTE, "ok", { spaceId });
  return json(view);
});
