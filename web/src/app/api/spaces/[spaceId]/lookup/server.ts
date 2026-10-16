import { PrismaFoodRepository, prisma, type FoodRepository, type FoodSource } from "@frejsi/shared";
import { foodSources } from "@frejsi/shared/food";
import { createPhotoStoreFromEnv, type PhotoStore } from "@frejsi/shared/photos";
import type { SearchEmbed } from "@frejsi/shared/food/types";
import type { SessionContext } from "@frejsi/shared";
import { foodSearchEmbed } from "@/lib/foods/semantic";
import type { SessionDb } from "@/lib/auth/session";

interface LookupDeps {
  repo: FoodRepository;
  searchEmbedding: (spaceId: string, session: SessionContext) => Promise<SearchEmbed | null>;
  sessionDb: SessionDb;
  sources: FoodSource[];
  photos: PhotoStore | null;
}
let overrides: Partial<LookupDeps> = {};
export function configureLookup(deps: Partial<LookupDeps>): void {
  overrides = deps;
}
export function lookupSessionDb(): SessionDb {
  return overrides.sessionDb ?? prisma;
}
export function lookupDeps(): LookupDeps {
  return {
    searchEmbedding: overrides.searchEmbedding ?? foodSearchEmbed,
    repo: overrides.repo ?? new PrismaFoodRepository(),
    sessionDb: overrides.sessionDb ?? prisma,
    sources: overrides.sources ?? foodSources(process.env),
    photos:
      overrides.photos !== undefined ? overrides.photos : createPhotoStoreFromEnv(process.env),
  };
}
