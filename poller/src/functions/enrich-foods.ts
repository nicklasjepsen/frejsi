import { app } from "@azure/functions";
import {
  emit,
  log,
  prisma,
  PrismaFoodRepository,
  type EmitFn,
  type FoodSource,
  type Logger,
  type Locale,
} from "@frejsi/shared";
import { foodSources } from "@frejsi/shared/food";
import {
  aiProviders,
  CappedAiProvider,
  PrismaAiCallRepository,
  type AiProviderRegistry,
  type AiCallRepository,
} from "@frejsi/shared/ai";
import { AiProviderId } from "@frejsi/shared/schemas/ai";
import type { EnrichmentRepository } from "@frejsi/shared/food/types";
import { embeddingIdentity, embeddingRevision } from "@frejsi/shared/ai/search/model";
import { normaliseFoodName } from "@frejsi/shared/ai/search/normalise";

export const SCHEDULE = "0 */15 * * * *";
interface EnrichmentSpace {
  id: string;
  aiEnabled: boolean;
  aiProvider: string | null;
  timezone: string;
  locale: Locale;
}
export interface EnrichmentDeps {
  repo: EnrichmentRepository;
  calls: AiCallRepository;
  emit: EmitFn;
  providers: AiProviderRegistry;
  remoteOrigins: string[];
  spaces: EnrichmentSpace[];
  env: Readonly<Record<string, string | undefined>>;
  log: Logger;
  now?: () => Date;
}
function cap(value: string | undefined, fallback: number) {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n)) throw new Error("Invalid cap");
  return n;
}
export async function runEnrichment(deps: EnrichmentDeps): Promise<void> {
  const entries = Object.entries(deps.providers).filter(
    ([, provider]) => provider.capabilities().embed,
  );
  if (!entries.length) {
    deps.log.info("enrich-foods", { code: "ai-not-configured", count: 0 });
    return;
  }
  const cacheId = deps.env.AI_CACHE_EMBED_PROVIDER ?? entries[0]?.[0];
  const cacheKey = AiProviderId.safeParse(cacheId);
  const cache = cacheKey.success ? deps.providers[cacheKey.data] : undefined;
  const enabled = deps.spaces.filter((space) => space.aiEnabled);
  const groups = [
    ...(cache?.capabilities().embed && cacheId
      ? [{ spaceId: null, id: cacheId, inner: cache, timezone: "UTC", locale: "da" as Locale }]
      : []),
    ...enabled.flatMap((space) => {
      const id = AiProviderId.safeParse(space.aiProvider);
      const inner = id.success ? deps.providers[id.data] : undefined;
      return inner?.capabilities().embed && id.success
        ? [
            {
              spaceId: space.id,
              id: id.data,
              inner,
              timezone: space.timezone,
              locale: space.locale,
            },
          ]
        : [];
    }),
  ].map((group) => ({
    ...group,
    provider: new CappedAiProvider(group.inner, deps.calls, {
      spaceId: group.spaceId,
      timezone: group.timezone,
      dailyCap: cap(deps.env.AI_DAILY_CAP, 50),
      embedDailyCap: cap(
        group.spaceId === null ? deps.env.AI_EMBED_BACKFILL_DAILY_CAP : deps.env.AI_EMBED_DAILY_CAP,
        group.spaceId === null ? 2000 : 500,
      ),
      ...(deps.now ? { now: deps.now } : {}),
    }),
  }));
  if (!groups.length) {
    deps.log.info("enrich-foods", { code: "ai-not-configured", count: 0 });
    return;
  }
  const spaceIds = enabled.map((space) => space.id);
  const normalisationSpaceIds = groups.flatMap((group) =>
    group.spaceId === null ? [] : [group.spaceId],
  );
  const rows = await deps.repo.normalisationCandidates(
    deps.remoteOrigins,
    normalisationSpaceIds,
    50,
    groups.some((group) => group.spaceId === null),
  );
  let normalised = 0;
  const processed = new Set<string>();
  for (const row of rows) {
    const group = groups.find((group) => group.spaceId === row.spaceId);
    if (row.verified || !group || processed.has(row.sourceRef)) continue;
    processed.add(row.sourceRef);
    const value = await normaliseFoodName(group.provider, row.name, group.locale);
    await deps.repo.setNormalisedName(row, value, spaceIds, deps.emit);
    normalised++;
  }
  deps.log.info("enrich-foods", { code: "normalised", count: normalised });
  let remaining = 100;
  for (const [index, group] of groups.entries()) {
    if (!remaining) break;
    const revision = embeddingRevision(group.id, deps.env);
    const batch = await deps.repo.embeddingCandidates(
      group.spaceId,
      revision,
      Math.ceil(remaining / (groups.length - index)),
    );
    if (!batch.length) continue;
    remaining -= batch.length;
    try {
      const result = await group.provider.embed({
        texts: batch.map((row) => row.name),
        use: group.spaceId === null ? "backfill" : "search",
      });
      const model = embeddingIdentity(revision, result.model);
      await deps.repo.setEmbeddings(
        batch.map((row, i) => ({
          id: row.id,
          name: row.name,
          vector: result.vectors[i] ?? [],
          model,
        })),
      );
      deps.log.info("enrich-foods", { code: "embedded", count: batch.length });
    } catch {
      deps.log.warn("enrich-foods", { code: "ai-unavailable", count: batch.length });
    }
  }
}

app.timer("enrich-foods", {
  schedule: SCHEDULE,
  runOnStartup: false,
  handler: async () => {
    // Build lazily: an unconfigured deployment can index and run without keys or a database call.
    const providers = aiProviders(process.env);
    if (!Object.values(providers).some((provider) => provider.capabilities().embed)) {
      log.info("enrich-foods", { code: "ai-not-configured", count: 0 });
      return;
    }
    const spaces = await prisma.space.findMany({
      where: { aiEnabled: true },
      select: {
        id: true,
        aiEnabled: true,
        aiProvider: true,
        timezone: true,
        memberships: {
          where: { role: "owner" },
          orderBy: { userId: "asc" },
          take: 1,
          select: { user: { select: { locale: true } } },
        },
      },
    });
    await runEnrichment({
      repo: new PrismaFoodRepository(),
      calls: new PrismaAiCallRepository(),
      emit,
      providers,
      remoteOrigins: foodSources(process.env)
        .filter((source: FoodSource) => source.kind === "remote")
        .map((source) => source.id),
      spaces: spaces.map((space) => ({
        ...space,
        locale: space.memberships[0]?.user.locale === "en" ? "en" : "da",
      })),
      env: process.env,
      log,
    });
  },
});
