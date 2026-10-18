// The only place the pump record's connection columns (`Space.pumpSource`, `pumpStatus`,
// `pumpFailures`) are written from the web, and the one reader of them for the Settings card
// (v0.7.0 plan §3, task 3). The address and the token never reach this module: the config holds a
// Key Vault reference, the person who connected it, and nothing else.
import {
  PumpSettingsView,
  PumpSourceConfig,
  PumpStatusPayload,
  SourceStatus,
  type PrismaClient,
} from "@frejsi/shared";

import { run, type AuthDeps } from "@/lib/auth/core";

/** The Space columns the card reads. */
export interface PumpSettingsRow {
  pumpSource: string | null;
  pumpStatus: string;
  lastPumpAt: Date | null;
}

/** The stored config, or null when there is none or it does not parse. */
export function pumpConfigOf(pumpSource: string | null): PumpSourceConfig | null {
  if (!pumpSource) return null;
  try {
    const parsed = PumpSourceConfig.safeParse(JSON.parse(pumpSource));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The card's view of the row: never the `secretRef`, never who connected it. */
export function toPumpSettingsView(row: PumpSettingsRow, since: string | null): PumpSettingsView {
  const status = SourceStatus.safeParse(row.pumpStatus);
  return PumpSettingsView.parse({
    status: status.success ? status.data : "not-configured",
    ...(since ? { since } : {}),
    ...(row.lastPumpAt ? { lastPumpAt: row.lastPumpAt.toISOString() } : {}),
    configured: pumpConfigOf(row.pumpSource) !== null,
  });
}

/**
 * The `since` of the space's latest `pump.status` event, or null before the first. The highest
 * `seq` is picked in code as well as asked for, so a store that ignores `orderBy` agrees.
 */
export async function latestPumpStatusSince(
  db: Pick<PrismaClient, "event">,
  spaceId: string,
): Promise<string | null> {
  const rows = await db.event.findMany({
    where: { spaceId, type: "pump.status" },
    orderBy: { seq: "desc" },
    take: 1,
  });
  const latest = rows.reduce<(typeof rows)[number] | null>(
    (best, row) => (best === null || row.seq > best.seq ? row : best),
    null,
  );
  if (!latest) return null;
  try {
    const parsed = PumpStatusPayload.safeParse(JSON.parse(latest.payload));
    return parsed.success ? parsed.data.since : null;
  } catch {
    return null;
  }
}

/**
 * After `source-connect` wrote the credential as a version of `pump-<spaceId>`: stores `{ type,
 * secretRef, connectedBy }`, sets `connected`, clears the failure count, and emits `pump.status`
 * and nothing else: it travels in the glucose group, so a viewer cannot tell that a pump connection
 * changed (no `space.updated`). Settings refreshes on `pump.status`. The glucose source is not
 * touched.
 */
export function savePumpSource(
  spaceId: string,
  config: PumpSourceConfig,
  deps: AuthDeps = {},
): Promise<PumpSettingsView> {
  return run(deps, async (tx, emit, now) => {
    const since = now().toISOString();
    const row = await tx.space.update({
      where: { id: spaceId },
      data: {
        pumpSource: JSON.stringify(PumpSourceConfig.parse(config)),
        pumpStatus: "connected",
        pumpFailures: 0,
      },
    });
    await emit(spaceId, "pump.status", { status: "connected", since });
    return toPumpSettingsView(row, since);
  });
}

/**
 * "Afbryd": clears the config, so the pump cycle stops reading, and sets `not-configured`. The
 * stored boluses, their meal links and `lastPumpAt` stay, as a glucose source's readings do when
 * it is changed (plan "Not in v0.7.0"). Emits `pump.status` only, as connecting does. Nothing to
 * disconnect writes and emits nothing.
 */
export function clearPumpSource(spaceId: string, deps: AuthDeps = {}): Promise<PumpSettingsView> {
  return run(deps, async (tx, emit, now) => {
    const before = await tx.space.findUnique({ where: { id: spaceId } });
    if (!before) throw new Error("space vanished");
    if (before.pumpSource === null && before.pumpStatus === "not-configured") {
      return toPumpSettingsView(before, await latestPumpStatusSince(tx, spaceId));
    }
    const since = now().toISOString();
    const row = await tx.space.update({
      where: { id: spaceId },
      data: { pumpSource: null, pumpStatus: "not-configured", pumpFailures: 0 },
    });
    await emit(spaceId, "pump.status", { status: "not-configured", since });
    return toPumpSettingsView(row, since);
  });
}
