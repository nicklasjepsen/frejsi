import { HttpError, prisma, type PrismaClient, type SessionContext } from "@frejsi/shared";
import {
  aiProviders,
  CappedAiProvider,
  PrismaAiCallRepository,
  type AiCallDb,
  type AiProvider,
} from "@frejsi/shared/ai";
import { AiProviderId } from "@frejsi/shared/schemas/ai";
import { assertRole } from "@/lib/auth/session";

export interface AiProviderDeps {
  db?: Pick<PrismaClient, "space"> & AiCallDb;
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
}

function cap(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed))
    throw new HttpError(503, "ai-not-configured");
  return parsed;
}

/** The web composition point: authorization, opt-in, configuration, then counted calls. */
export async function aiForSpace(
  spaceId: string,
  session: SessionContext,
  deps: AiProviderDeps = {},
): Promise<AiProvider> {
  assertRole(session, spaceId, "owner", "carer");
  const db = deps.db ?? prisma;
  const space = await db.space.findUnique({
    where: { id: spaceId },
    select: { aiEnabled: true, aiProvider: true, timezone: true },
  });
  if (!space) throw new HttpError(404, "not-found");
  if (!space.aiEnabled) throw new HttpError(409, "ai-disabled");
  const env = deps.env ?? process.env;
  const id = AiProviderId.safeParse(space.aiProvider);
  const inner = id.success ? aiProviders(env)[id.data] : undefined;
  if (!inner) throw new HttpError(503, "ai-not-configured");
  return new CappedAiProvider(inner, new PrismaAiCallRepository(db), {
    spaceId,
    userId: session.userId,
    timezone: space.timezone,
    dailyCap: cap(env.AI_DAILY_CAP, 50),
    embedDailyCap: cap(env.AI_EMBED_DAILY_CAP, 500),
    ...(deps.now ? { now: deps.now } : {}),
  });
}
