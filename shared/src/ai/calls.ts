import type { AiUse } from "./types";

export type AiCallKind = "complete" | "vision" | "embed";
export interface AiCallRow {
  id: string;
  spaceId: string | null;
  userId: string | null;
  kind: AiCallKind;
  use: AiUse;
  provider: string;
  model: string;
  ok: boolean;
  ms: number;
  ts: Date;
}
export interface AiCallWindow {
  spaceId: string | null;
  from: Date;
  to: Date;
  kinds: AiCallKind[];
}
export interface ReserveAiCall extends AiCallWindow {
  limit: number;
  row: Omit<AiCallRow, "id" | "model" | "ok" | "ms">;
}
export interface AiCallRepository {
  /** Atomically count and insert a pending attempt, including a refused attempt. */
  reserve(input: ReserveAiCall): Promise<{ id: string; allowed: boolean }>;
  finish(id: string, result: { model: string; ok: boolean; ms: number }): Promise<void>;
  count(window: AiCallWindow): Promise<number>;
}

export class MemoryAiCallRepository implements AiCallRepository {
  readonly rows: AiCallRow[] = [];
  private total(window: AiCallWindow) {
    return this.rows.filter(
      (row) =>
        row.spaceId === window.spaceId &&
        row.ts >= window.from &&
        row.ts < window.to &&
        window.kinds.includes(row.kind),
    ).length;
  }
  reserve(input: ReserveAiCall): Promise<{ id: string; allowed: boolean }> {
    const allowed = this.total(input) < input.limit;
    const id = String(this.rows.length + 1);
    this.rows.push({ ...input.row, ts: new Date(input.row.ts), id, model: "", ok: false, ms: 0 });
    return Promise.resolve({ id, allowed });
  }
  finish(id: string, result: { model: string; ok: boolean; ms: number }): Promise<void> {
    const row = this.rows.find((row) => row.id === id);
    if (!row) return Promise.reject(new Error("Unknown AI call"));
    Object.assign(row, result);
    return Promise.resolve();
  }
  count(window: AiCallWindow): Promise<number> {
    return Promise.resolve(this.total(window));
  }
}
