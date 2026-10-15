import type { FoodCandidate, FoodSourceStatus } from "../schemas/food";
import type { Locale } from "../schemas/settings";
import type { FoodSource, FoodSourceResult } from "./types";

export interface FakeFoodSourceOptions {
  id: string;
  kind: "remote" | "local";
  candidates?: FoodCandidate[];
  status?: FoodSourceStatus;
  error?: Error;
}
/** Fictional, deterministic adapter for tests and seeds. */
export class FakeFoodSource implements FoodSource {
  readonly id: string;
  readonly kind: "remote" | "local";
  readonly calls: (
    { method: "search"; q: string; locale: Locale } | { method: "byBarcode"; barcode: string }
  )[] = [];

  constructor(private readonly options: FakeFoodSourceOptions) {
    this.id = options.id;
    this.kind = options.kind;
  }
  search(q: string, locale: Locale, _signal: AbortSignal): Promise<FoodSourceResult> {
    this.calls.push({ method: "search", q, locale });
    return this.result();
  }
  byBarcode(barcode: string, _signal: AbortSignal): Promise<FoodSourceResult> {
    this.calls.push({ method: "byBarcode", barcode });
    return this.result();
  }
  private result(): Promise<FoodSourceResult> {
    if (this.options.error) return Promise.reject(this.options.error);
    return Promise.resolve({
      status: this.options.status ?? "ok",
      candidates: structuredClone(this.options.candidates ?? []),
    });
  }
}
