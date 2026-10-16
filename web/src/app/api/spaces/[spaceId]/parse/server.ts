import {
  PrismaFoodRepository,
  prisma,
  type FoodRepository,
  type FoodSource,
  type SessionContext,
} from "@frejsi/shared";
import type { AiProvider } from "@frejsi/shared/ai";
import { foodSources } from "@frejsi/shared/food";
import { aiForSpace } from "@/ai/provider";
import type { SessionDb } from "@/lib/auth/session";

interface ParseDeps {
  sessionDb: SessionDb;
  repo: FoodRepository;
  sources: FoodSource[];
  enabled: (spaceId: string) => Promise<boolean>;
  provider: (spaceId: string, session: SessionContext) => Promise<AiProvider>;
}
let overrides: Partial<ParseDeps> = {};
export function configureParse(deps: Partial<ParseDeps>) {
  overrides = deps;
}
export function parseSessionDb() {
  return overrides.sessionDb ?? prisma;
}
export function parseDeps() {
  return {
    enabled:
      overrides.enabled ??
      (async (spaceId: string) => {
        const space = await prisma.space.findUnique({
          where: { id: spaceId },
          select: { aiEnabled: true },
        });
        return space?.aiEnabled ?? false;
      }),
    repo: overrides.repo ?? new PrismaFoodRepository(),
    sources: overrides.sources ?? foodSources(process.env),
    provider: overrides.provider ?? aiForSpace,
  };
}
