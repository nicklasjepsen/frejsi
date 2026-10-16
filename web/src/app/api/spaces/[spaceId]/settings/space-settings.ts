// The only place the per-space settings columns (unit, target range, glucose source) are written.
import {
  GlucoseSourceConfig,
  HttpError,
  SourceStatusPayload,
  SpaceSettings,
  type GlucoseSourceType,
  type PrismaClient,
} from "@frejsi/shared";

import { SourceView, definedOnly, type SpaceSettingsPatch } from "@/components/settings/contracts";
import { configuredAiProviders } from "@/ai/provider";
import { run, type AuthDeps } from "@/lib/auth/core";

/** The Space columns the settings read; `targetLow/High` arrive as Prisma Decimals. */
export interface SpaceSettingsRow {
  aiEnabled?: boolean;
  aiProvider?: string | null;
  name: string;
  timezone: string;
  glucoseUnit: string;
  targetLow: { toString(): string } | number;
  targetHigh: { toString(): string } | number;
  glucoseSource: string | null;
  sourceStatus: string;
  lastReadingAt: Date | null;
}

/** The stored source config, or null when there is none or it does not parse. */
export function sourceConfigOf(glucoseSource: string | null): GlucoseSourceConfig | null {
  if (!glucoseSource) return null;
  try {
    const parsed = GlucoseSourceConfig.safeParse(JSON.parse(glucoseSource));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The source type from the stored JSON, or null when there is none or it does not parse. */
export function sourceTypeOf(glucoseSource: string | null): GlucoseSourceType | null {
  return sourceConfigOf(glucoseSource)?.type ?? null;
}

/** The `/source` view of the row: type, region and status; never the `secretRef`. */
export function toSourceView(row: SpaceSettingsRow, since: string | null): SourceView {
  const config = sourceConfigOf(row.glucoseSource);
  return SourceView.parse({
    type: config?.type ?? null,
    region: config && "region" in config ? config.region : null,
    status: row.sourceStatus,
    lastReadingAt: row.lastReadingAt ? row.lastReadingAt.toISOString() : null,
    since,
  });
}

/**
 * The `since` of the space's latest `source.status` event, or null before the first one. Reads
 * the events table; only `emit()` writes it. The highest `seq` is picked in code as well as asked
 * for, so a store that ignores `orderBy` (the fake in tests) gives the same answer.
 */
export async function latestSourceStatusSince(
  db: Pick<PrismaClient, "event">,
  spaceId: string,
): Promise<string | null> {
  const rows = await db.event.findMany({
    where: { spaceId, type: "source.status" },
    orderBy: { seq: "desc" },
    take: 1,
  });
  const latest = rows.reduce<(typeof rows)[number] | null>(
    (best, row) => (best === null || row.seq > best.seq ? row : best),
    null,
  );
  if (!latest) return null;
  try {
    const parsed = SourceStatusPayload.safeParse(JSON.parse(latest.payload));
    return parsed.success ? parsed.data.since : null;
  } catch {
    return null;
  }
}

/** The shared contract from the row: never the `secretRef`, never the raw JSON (plan §4). */
export function toSpaceSettings(row: SpaceSettingsRow): SpaceSettings {
  return SpaceSettings.parse({
    aiEnabled: row.aiEnabled ?? false,
    ...(row.aiProvider ? { aiProvider: row.aiProvider } : {}),
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
 * moved across the other. The check and the write share a serializable transaction: two owners
 * saving one end each (9 as low, 5 as high, from 4–10) would otherwise both pass against 4–10 and
 * leave 9–5 behind.
 */
export function updateSpaceSettings(
  spaceId: string,
  patch: SpaceSettingsPatch,
  deps: AuthDeps = {},
): Promise<SpaceSettings> {
  return run(
    deps,
    async (tx, emit) => {
      const current = await tx.space.findUnique({ where: { id: spaceId } });
      if (!current) throw new HttpError(404, "not-found");
      const provider = patch.aiProvider ?? current.aiProvider;
      if (
        (patch.aiProvider !== undefined || patch.aiEnabled === true) &&
        (!provider || !Object.hasOwn(configuredAiProviders(), provider))
      ) {
        throw new HttpError(400, "ai-not-configured");
      }
      const low = patch.targetLow ?? Number(current.targetLow.toString());
      const high = patch.targetHigh ?? Number(current.targetHigh.toString());
      if (low >= high) throw new HttpError(400, "validation");
      const data = definedOnly(patch);
      const row = await tx.space.update({ where: { id: spaceId }, data });
      await emit(spaceId, "space.updated", { fields: Object.keys(data) });
      return toSpaceSettings(row);
    },
    { serializable: true },
  );
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
