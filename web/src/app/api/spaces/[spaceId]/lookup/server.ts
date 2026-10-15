import { PrismaFoodRepository, prisma, type FoodRepository, type FoodSource } from "@frejsi/shared";
import { foodSources } from "@frejsi/shared/food";
import { createPhotoStoreFromEnv, type PhotoStore } from "@frejsi/shared/photos";
import type { SessionDb } from "@/lib/auth/session";

interface LookupDeps {
  repo: FoodRepository;
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
    repo: overrides.repo ?? new PrismaFoodRepository(),
    sessionDb: overrides.sessionDb ?? prisma,
    sources: overrides.sources ?? foodSources(process.env),
    photos:
      overrides.photos !== undefined ? overrides.photos : createPhotoStoreFromEnv(process.env),
  };
}
