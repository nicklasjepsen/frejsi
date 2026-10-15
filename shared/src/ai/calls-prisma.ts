import { prisma } from "../db/client";
import type { AiCallRepository, AiCallRow, AiCallWindow, ReserveAiCall } from "./calls";

interface CountArgs {
  where: { spaceId: string | null; ts: { gte: Date; lt: Date }; kind: { in: string[] } };
}
interface CallDelegate {
  count(args: CountArgs): Promise<number>;
  create(args: { data: Omit<AiCallRow, "id">; select: { id: true } }): Promise<{ id: string }>;
  update(args: {
    where: { id: string };
    data: { model: string; ok: boolean; ms: number };
    select: { id: true };
  }): Promise<{ id: string }>;
}
export interface AiCallDb {
  aiCall: CallDelegate;
  $transaction<T>(
    work: (tx: { aiCall: CallDelegate }) => Promise<T>,
    options: { isolationLevel: "Serializable" },
  ): Promise<T>;
}
const filter = (window: AiCallWindow): CountArgs => ({
  where: {
    spaceId: window.spaceId,
    ts: { gte: window.from, lt: window.to },
    kind: { in: window.kinds },
  },
});

/** AiCall is content-free bookkeeping, not space data (plan decision 5). Its sole writer. */
export class PrismaAiCallRepository implements AiCallRepository {
  constructor(private readonly db: AiCallDb = prisma) {}
  count(window: AiCallWindow): Promise<number> {
    return this.db.aiCall.count(filter(window));
  }
  async reserve(input: ReserveAiCall): Promise<{ id: string; allowed: boolean }> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(
          async (tx) => {
            const count = await tx.aiCall.count(filter(input));
            const row = await tx.aiCall.create({
              data: { ...input.row, model: "", ok: false, ms: 0 },
              select: { id: true },
            });
            return { id: row.id, allowed: count < input.limit };
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        if (
          attempt >= 4 ||
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "P2034"
        )
          throw error;
      }
    }
  }
  async finish(id: string, result: { model: string; ok: boolean; ms: number }): Promise<void> {
    await this.db.aiCall.update({ where: { id }, data: result, select: { id: true } });
  }
}
