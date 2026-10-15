// The only place the per-space settings columns (unit, target range, glucose source) are written.
import {
  GlucoseSourceConfig,
  HttpError,
  SpaceSettings,
  type GlucoseSourceType,
} from "@frejsi/shared";

import { definedOnly, type SpaceSettingsPatch } from "@/components/settings/contracts";
import { run, type AuthDeps } from "@/lib/auth/core";

/** The Space columns the settings read; `targetLow/High` arrive as Prisma Decimals. */
export interface SpaceSettingsRow {
  name: string;
  timezone: string;
  glucoseUnit: string;
  targetLow: { toString(): string } | number;
  targetHigh: { toString(): string } | number;
  glucoseSource: string | null;
  sourceStatus: string;
  lastReadingAt: Date | null;
}

/** The source type from the stored JSON, or null when there is none or it does not parse. */
export function sourceTypeOf(glucoseSource: string | null): GlucoseSourceType | null {
  if (!glucoseSource) return null;
  try {
    const parsed = GlucoseSourceConfig.safeParse(JSON.parse(glucoseSource));
    return parsed.success ? parsed.data.type : null;
  } catch {
    return null;
  }
}

/** The shared contract from the row: never the `secretRef`, never the raw JSON (plan §4). */
export function toSpaceSettings(row: SpaceSettingsRow): SpaceSettings {
  return SpaceSettings.parse({
    name: row.name,
    timezone: row.timezone,
    glucoseUnit: row.glucoseUnit,
    targetLow: Number(row.targetLow.toString()),
    targetHigh: Number(row.targetHigh.toString()),
    sourceType: sourceTypeOf(row.glucoseSource),
    sourceStatus: row.sourceStatus,
    lastReadingAt: row.lastReadingAt ? row.lastReadingAt.toISOString() : null,
  });
}

/**
 * Writes the unit and the target range (always in mmol, plan §3) and emits `space.updated` with
 * the fields that changed. A range is checked against the stored other end, so one end cannot be
 * moved across the other.
 */
export function updateSpaceSettings(
  spaceId: string,
  patch: SpaceSettingsPatch,
  deps: AuthDeps = {},
): Promise<SpaceSettings> {
  return run(deps, async (tx, emit) => {
    const current = await tx.space.findUnique({ where: { id: spaceId } });
    if (!current) throw new HttpError(404, "not-found");
    const low = patch.targetLow ?? Number(current.targetLow.toString());
    const high = patch.targetHigh ?? Number(current.targetHigh.toString());
    if (low >= high) throw new HttpError(400, "validation");
    const data = definedOnly(patch);
    const row = await tx.space.update({ where: { id: spaceId }, data });
    await emit(spaceId, "space.updated", { fields: Object.keys(data) });
    return toSpaceSettings(row);
  });
}

/**
 * After `source-connect` has written the credential to Key Vault: stores `{ type, region,
 * secretRef }` and nothing else, sets `connected`, clears the failure count, and emits
 * `source.status` (so Now's banner goes away live) then `space.updated`.
 */
export function saveConnectedSource(
  spaceId: string,
  config: GlucoseSourceConfig,
  deps: AuthDeps = {},
): Promise<SpaceSettings> {
  return run(deps, async (tx, emit, now) => {
    const row = await tx.space.update({
      where: { id: spaceId },
      data: {
        glucoseSource: JSON.stringify(GlucoseSourceConfig.parse(config)),
        sourceStatus: "connected",
        sourceFailures: 0,
      },
    });
    await emit(spaceId, "source.status", { status: "connected", since: now().toISOString() });
    await emit(spaceId, "space.updated", { fields: ["glucoseSource", "sourceStatus"] });
    return toSpaceSettings(row);
  });
}
