import { HttpError, prisma, type PrismaClient } from "@frejsi/shared";
import { PrismaAiCallRepository, type AiCallRepository } from "@frejsi/shared/ai";
import { dayRange } from "@frejsi/shared/meals/day-range";
import { AiProviderId, AiUsage } from "@frejsi/shared/schemas/ai";
import { aiCap, configuredAiProviders } from "@/ai/provider";

export async function loadAiUsage(
  spaceId: string,
  deps: {
    db?: Pick<PrismaClient, "space">;
    calls?: Pick<AiCallRepository, "count">;
    env?: Readonly<Record<string, string | undefined>>;
    now?: Date;
  } = {},
): Promise<AiUsage> {
  const space = await (deps.db ?? prisma).space.findUnique({ where: { id: spaceId } });
  if (!space) throw new HttpError(404, "not-found");
  const env = deps.env ?? process.env;
  const registry = configuredAiProviders(env);
  const now = deps.now ?? new Date();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: space.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [from, to] = dayRange(date, space.timezone);
  const calls = deps.calls ?? new PrismaAiCallRepository(prisma);
  const window = { spaceId, from, to };
  const [callsToday, embedCallsToday] = await Promise.all([
    calls.count({ ...window, kinds: ["complete", "vision"] }),
    calls.count({ ...window, kinds: ["embed"] }),
  ]);
  return AiUsage.parse({
    enabled: space.aiEnabled,
    ...(space.aiProvider ? { provider: space.aiProvider } : {}),
    providers: AiProviderId.options.map((id) => ({
      id,
      configured: !!registry[id],
      capabilities: registry[id]?.capabilities() ?? {
        complete: false,
        vision: false,
        embed: false,
      },
    })),
    callsToday,
    embedCallsToday,
    dailyCap: aiCap(env.AI_DAILY_CAP, 50),
    embedDailyCap: aiCap(env.AI_EMBED_DAILY_CAP, 500),
    ...(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
      ? { pushPublicKey: env.VAPID_PUBLIC_KEY }
      : {}),
  });
}
