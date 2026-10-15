import { dayRange } from "../meals/day-range";
import { HttpError } from "../schemas/api";
import type { AiCallKind, AiCallRepository } from "./calls";
import { guardOutput } from "./guard";
import type {
  AiProvider,
  AiUse,
  CompleteRequest,
  CompleteResult,
  EmbedRequest,
  EmbedResult,
  VisionRequest,
} from "./types";

export interface CappedAiOptions {
  spaceId: string | null;
  userId?: string | null;
  dailyCap?: number;
  embedDailyCap?: number;
  timezone: string;
  now?: () => Date;
  use?: AiUse;
}

export class CappedAiProvider implements AiProvider {
  readonly id = "capped";
  private readonly now: () => Date;
  constructor(
    private readonly inner: AiProvider,
    private readonly calls: AiCallRepository,
    private readonly options: CappedAiOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    for (const cap of [options.dailyCap ?? 50, options.embedDailyCap ?? 500])
      if (!Number.isSafeInteger(cap) || cap < 0) throw new Error("Invalid AI cap");
  }
  capabilities() {
    return this.inner.capabilities();
  }
  complete(req: CompleteRequest): Promise<CompleteResult> {
    return this.attempt("complete", req.use ?? this.options.use ?? "parse", async (remember) => {
      const result = await this.inner.complete(req);
      remember(result.model);
      return this.validate(result, req.outputSchema);
    });
  }
  vision(req: VisionRequest): Promise<CompleteResult> {
    return this.attempt("vision", req.use ?? this.options.use ?? "estimate", async (remember) => {
      const result = await this.inner.vision(req);
      remember(result.model);
      return this.validate(result, req.outputSchema);
    });
  }
  embed(req: EmbedRequest): Promise<EmbedResult> {
    return this.attempt("embed", req.use ?? this.options.use ?? "search", async (remember) => {
      const result = await this.inner.embed(req);
      remember(result.model);
      if (
        result.vectors.length !== req.texts.length ||
        result.vectors.some(
          (vector) => vector.length !== 1024 || vector.some((value) => !Number.isFinite(value)),
        )
      )
        throw new HttpError(502, "ai-rejected");
      return result;
    });
  }
  private validate(
    result: CompleteResult,
    schema: CompleteRequest["outputSchema"],
  ): CompleteResult {
    if (result.kind === "refusal") throw new HttpError(503, "ai-unavailable");
    if (result.kind === "json") {
      if (!schema) throw new HttpError(502, "ai-rejected");
      const parsed = schema.safeParse(result.json);
      if (!parsed.success) throw new HttpError(502, "ai-rejected");
      guardOutput(parsed.data);
      return { ...result, json: parsed.data };
    }
    guardOutput(result);
    return result;
  }
  private async attempt<T extends { model: string }>(
    kind: AiCallKind,
    use: AiUse,
    invoke: (remember: (model: string) => void) => Promise<T>,
  ): Promise<T> {
    const ts = this.now();
    const timezone = this.options.spaceId === null ? "UTC" : this.options.timezone;
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(ts);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const [from, to] = dayRange(`${part("year")}-${part("month")}-${part("day")}`, timezone);
    const reservation = await this.calls.reserve({
      spaceId: this.options.spaceId,
      from,
      to,
      kinds: kind === "embed" ? ["embed"] : ["complete", "vision"],
      limit: kind === "embed" ? (this.options.embedDailyCap ?? 500) : (this.options.dailyCap ?? 50),
      row: {
        spaceId: this.options.spaceId,
        userId: this.options.userId ?? null,
        kind,
        use,
        provider: this.inner.id,
        ts,
      },
    });
    const start = performance.now();
    let model = "";
    let ok = false;
    try {
      if (!reservation.allowed) throw new HttpError(429, "ai-cap-reached");
      const result = await invoke((value) => {
        model = value;
      });
      model = result.model;
      ok = true;
      return result;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, "ai-unavailable");
    } finally {
      await this.calls.finish(reservation.id, {
        model,
        ok,
        ms: Math.min(2_147_483_647, Math.max(0, Math.round(performance.now() - start))),
      });
    }
  }
}
