import type { ContributionResult, FoodCorrection } from "../schemas/food";
import type { FoodContributor } from "./types";

export interface FakeFoodContributorOptions {
  id?: string;
  /** Answers in order; the last one repeats. Defaults to a single `ok`. */
  script?: ContributionResult["status"][];
}
/** Deterministic contributor for tests, the seed, the CLI and the e2e: no network, no account. */
export class FakeFoodContributor implements FoodContributor {
  readonly id: string;
  readonly corrections: FoodCorrection[] = [];
  constructor(private readonly options: FakeFoodContributorOptions = {}) {
    this.id = options.id ?? "off";
  }
  contribute(correction: FoodCorrection, signal: AbortSignal): Promise<ContributionResult> {
    this.corrections.push(structuredClone(correction));
    if (signal.aborted) return Promise.resolve({ status: "error" });
    const script = this.options.script ?? ["ok"];
    const status = script[Math.min(this.corrections.length - 1, script.length - 1)] ?? "ok";
    return Promise.resolve({ status });
  }
}
