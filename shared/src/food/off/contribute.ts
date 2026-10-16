import { z } from "zod";

import { FoodCorrection, type ContributionResult } from "../../schemas/food";
import type { FoodContributor } from "../types";
import { type OffRateLimits, processLimits } from "./rate-limit";

const DEFAULT_HOST = "world.openfoodfacts.org";
const STAGING_HOST = "world.openfoodfacts.net";
const WRITE_PATH = "/cgi/product_jqm2.pl";
const TIMEOUT_MS = 10_000;

interface Options {
  fetch: typeof fetch;
  /** The deployment's OFF account; read once in registry.ts. Never logged, never in an error. */
  user: string;
  password: string;
  version: string;
  host?: string | undefined;
  limits?: OffRateLimits;
}
const WriteResponse = z.looseObject({
  status: z.number(),
  status_verbose: z.string().optional(),
});
const result = (status: ContributionResult["status"]): ContributionResult => ({ status });

/**
 * Sends a human-approved carbohydrate/serving correction to OFF's write API as app "Frejsi".
 * It reads no repository and writes nothing to `Food`; every failure is a status, never a
 * thrown value or log line, because the request carries the password and the barcode.
 */
export class OffContributor implements FoodContributor {
  readonly id = "off";
  private readonly limits: OffRateLimits;
  private readonly host: string;
  constructor(private readonly options: Options) {
    this.limits = options.limits ?? processLimits;
    this.host = options.host?.trim() ? options.host.trim() : DEFAULT_HOST;
  }
  async contribute(correction: FoodCorrection, signal: AbortSignal): Promise<ContributionResult> {
    const parsed = FoodCorrection.safeParse(correction);
    if (!parsed.success || signal.aborted) return result("error");
    const input = parsed.data;
    if (!this.limits.write.take()) return result("rate-limited");

    const form = new URLSearchParams({
      code: input.barcode,
      user_id: this.options.user,
      password: this.options.password,
      app_name: "Frejsi",
      app_version: this.options.version,
      app_uuid: input.appRef,
    });
    if (input.carbsPer100g !== undefined) {
      // Stored per 100 g whatever the product was set to.
      form.set("nutrition_data_per", "100g");
      form.set("nutriment_carbohydrates", String(input.carbsPer100g));
      form.set("nutriment_carbohydrates_unit", "g");
    }
    if (input.servingSize) form.set("serving_size", `${input.servingSize.grams} g`);
    form.set("comment", "Correction from Frejsi");

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": `Frejsi/${this.options.version} (+https://github.com/nicklasjepsen/frejsi)`,
    };
    // OFF's staging host sits behind HTTP basic authentication, publicly documented as off:off.
    if (this.host === STAGING_HOST)
      headers.Authorization = `Basic ${Buffer.from("off:off").toString("base64")}`;

    const timeout = new AbortController();
    const timer = setTimeout(() => {
      timeout.abort();
    }, TIMEOUT_MS);
    try {
      const response = await this.options.fetch(`https://${this.host}${WRITE_PATH}`, {
        method: "POST",
        headers,
        body: form.toString(),
        signal: AbortSignal.any([signal, timeout.signal]),
      });
      if (response.status === 429) return result("rate-limited");
      if (!response.ok) return result("error");
      const body = WriteResponse.parse(await response.json());
      if (body.status === 1) return result("ok");
      if (body.status === 0)
        return result(
          /user|login|password|credential/i.test(body.status_verbose ?? "")
            ? "bad-credentials"
            : "rejected",
        );
      return result("error");
    } catch {
      return result("error");
    } finally {
      clearTimeout(timer);
    }
  }
}
