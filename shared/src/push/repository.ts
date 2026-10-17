import { prisma } from "../db/client";
import type { PrismaClient } from "@prisma/client";
import { Portion } from "../schemas/food";
import { localeOrDefault } from "../schemas/settings";
import { z } from "zod";
import { parseSpaceKinds } from "../symptoms/kinds";
import type { PushRepository, PushRecipient, SymptomLogger } from "./sink";

/** Delivery bookkeeping only: expired endpoints and failure counters do not emit. */
export class PrismaPushRepository implements PushRepository {
  constructor(
    private readonly db: Pick<
      PrismaClient,
      "pushSubscription" | "food" | "user" | "membership" | "space"
    > = prisma,
  ) {}
  async asked(spaceId: string, foodId: string, byUserId: string) {
    const [space, food, user, member] = await Promise.all([
      this.db.space.findUnique({ where: { id: spaceId }, select: { aiEnabled: true } }),
      this.db.food.findFirst({ where: { id: foodId, spaceId, origin: "ai", createdBy: byUserId } }),
      this.db.user.findUnique({ where: { id: byUserId }, select: { name: true } }),
      this.db.membership.findUnique({ where: { userId_spaceId: { userId: byUserId, spaceId } } }),
    ]);
    if (!space?.aiEnabled || !food || !user || !member || member.role === "viewer") return null;
    const portions = z.array(Portion).parse(JSON.parse(food.portions));
    const first = portions[0];
    if (first?.carbs === undefined) return null;
    return { child: user.name, dishName: food.name, carbs: first.carbs };
  }
  async symptomLogger(spaceId: string, byUserId: string): Promise<SymptomLogger | null> {
    const [space, user, member] = await Promise.all([
      this.db.space.findUnique({
        where: { id: spaceId },
        select: { timezone: true, symptomKinds: true },
      }),
      this.db.user.findUnique({ where: { id: byUserId }, select: { name: true, simpleMode: true } }),
      this.db.membership.findUnique({ where: { userId_spaceId: { userId: byUserId, spaceId } } }),
    ]);
    if (!space || !user || !member || member.role === "viewer") return null;
    return {
      child: user.name,
      simpleMode: user.simpleMode,
      timezone: space.timezone,
      symptomKinds: parseSpaceKinds(space.symptomKinds),
    };
  }
  async recipients(spaceId: string, excludeUserId: string): Promise<PushRecipient[]> {
    const rows = await this.db.pushSubscription.findMany({
      where: {
        spaceId,
        userId: { not: excludeUserId },
        session: { expiresAt: { gt: new Date() } },
        user: { memberships: { some: { spaceId, role: { in: ["owner", "carer"] } } } },
      },
      include: { user: { select: { locale: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      endpoint: r.endpoint,
      keys: { p256dh: r.p256dh, auth: r.auth },
      locale: localeOrDefault(r.user.locale),
    }));
  }
  async remove(id: string): Promise<void> {
    await this.db.pushSubscription.deleteMany({ where: { id } });
  }
  async failed(id: string): Promise<void> {
    await this.db.pushSubscription.updateMany({
      where: { id },
      data: { failures: { increment: 1 } },
    });
  }
}
