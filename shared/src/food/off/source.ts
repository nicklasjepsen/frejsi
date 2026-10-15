import { z } from "zod";
import type { Locale } from "../../schemas/settings";
import { normaliseBarcode } from "../barcode";
import type { FoodSource, FoodSourceResult } from "../types";
import { mapProduct } from "./map";
import { type OffRateLimits, processLimits } from "./rate-limit";

interface Options {
  fetch: typeof fetch;
  country?: string | undefined;
  version: string;
  locale?: Locale;
  limits?: OffRateLimits;
}
const SearchResponse = z.looseObject({ products: z.array(z.unknown()) });
const ProductResponse = z.looseObject({ status: z.number(), product: z.unknown().optional() });
const result = (
  status: FoodSourceResult["status"],
  candidates: FoodSourceResult["candidates"] = [],
): FoodSourceResult => ({ status, candidates });
class RequestFailure extends Error {
  constructor(readonly status: FoodSourceResult["status"]) {
    super(status);
  }
}
export class OffSource implements FoodSource {
  readonly id = "off";
  readonly kind = "remote";
  private readonly limits: OffRateLimits;
  private readonly country: string;
  constructor(private readonly options: Options) {
    this.limits = options.limits ?? processLimits;
    const country = options.country?.trim().toLowerCase();
    this.country = country?.length ? country : "world";
    if (!/^[a-z]{2}$|^world$/.test(this.country)) throw new Error("Invalid OFF country");
  }
  private async request(
    url: URL,
    type: "search" | "product",
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (!this.limits[type].take()) throw new RequestFailure("rate-limited");
    const response = await this.options.fetch(url, {
      signal,
      headers: {
        "User-Agent": `Frejsi/${this.options.version} (+https://github.com/nicklasjepsen/frejsi)`,
      },
    });
    signal.throwIfAborted();
    if (response.status === 429) throw new RequestFailure("rate-limited");
    // OFF may use HTTP 404 with its normal status:0 product reply.
    if (!response.ok && !(type === "product" && response.status === 404))
      throw new RequestFailure("error");
    const body: unknown = await response.json();
    signal.throwIfAborted();
    return body;
  }
  private fields(locale: Locale): string {
    return `code,product_name,product_name_${locale},brands,nutriments,serving_size,serving_quantity,serving_quantity_unit`;
  }
  async byBarcode(barcode: string, signal: AbortSignal): Promise<FoodSourceResult> {
    const code = normaliseBarcode(barcode);
    if (!code) return result("ok");
    try {
      const locale = this.options.locale ?? "en";
      const url = new URL(`https://world.openfoodfacts.org/api/v2/product/${code}.json`);
      url.searchParams.set("fields", this.fields(locale));
      const body = ProductResponse.parse(await this.request(url, "product", signal));
      if (body.status === 0) return result("ok");
      if (body.status !== 1) return result("error");
      const candidate = mapProduct(body.product, locale);
      // A wrong product must never be cached under the barcode being scanned.
      return result("ok", candidate?.barcode === code ? [candidate] : []);
    } catch (error) {
      return result(this.failure(error, signal));
    }
  }
  async search(q: string, locale: Locale, signal: AbortSignal): Promise<FoodSourceResult> {
    const candidates: FoodSourceResult["candidates"] = [];
    try {
      const seen = new Set<string>();
      const hosts = this.country === "world" ? ["world"] : [this.country, "world"];
      for (const host of hosts) {
        const url = new URL(`https://${host}.openfoodfacts.org/cgi/search.pl`);
        url.search = new URLSearchParams({
          search_terms: q,
          search_simple: "1",
          action: "process",
          json: "1",
          page_size: "10",
          fields: this.fields(locale),
        }).toString();
        const body = SearchResponse.parse(await this.request(url, "search", signal));
        for (const product of body.products) {
          const candidate = mapProduct(product, locale);
          if (candidate && !seen.has(candidate.sourceRef)) {
            seen.add(candidate.sourceRef);
            candidates.push(candidate);
          }
        }
        if (body.products.length >= 5) break;
      }
      return result("ok", candidates.slice(0, 10));
    } catch (error) {
      // The world fallback supplements a successful country response. Keep those
      // matches if only the optional request fails; cancellation still wins.
      if (candidates.length > 0 && !signal.aborted) return result("ok", candidates.slice(0, 10));
      return result(this.failure(error, signal));
    }
  }
  private failure(error: unknown, signal: AbortSignal): FoodSourceResult["status"] {
    return signal.aborted ? "timeout" : error instanceof RequestFailure ? error.status : "error";
  }
}
