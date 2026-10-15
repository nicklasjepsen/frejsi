import type { Locale } from "../../schemas/settings";
import { FoodCandidate } from "../../schemas/food";
import { foldForSearch } from "../search";
import type { FoodSource, FoodSourceResult } from "../types";
import { FridaEntry } from "./entry";

type Loader = () => Promise<unknown>;
const cancelled = (signal: AbortSignal): boolean => signal.aborted;
let bundled: Promise<FridaEntry[]> | undefined;
function loadBundled(): Promise<FridaEntry[]> {
  // A literal import lets the web bundler include the offline data in the deployment.
  return (bundled ??= import("./data/frida.json").then((module) =>
    FridaEntry.array().parse(module.default),
  ));
}
export class FridaSource implements FoodSource {
  readonly id = "frida";
  readonly kind = "local";
  private entries: Promise<FridaEntry[]> | undefined;
  constructor(private readonly load: Loader = loadBundled) {}
  byBarcode(_barcode: string, _signal: AbortSignal): Promise<FoodSourceResult> {
    return Promise.resolve({ status: "skipped", candidates: [] });
  }
  async search(q: string, locale: Locale, signal: AbortSignal): Promise<FoodSourceResult> {
    if (cancelled(signal)) return { status: "timeout", candidates: [] };
    const words = foldForSearch(q).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return { status: "ok", candidates: [] };
    try {
      this.entries ??= this.load().then((data) => FridaEntry.array().parse(data));
      const entries = await this.entries;
      signal.throwIfAborted();
      const candidates: FoodCandidate[] = [];
      for (const entry of entries) {
        const name = entry.name[locale] || entry.name[locale === "da" ? "en" : "da"];
        const folded = foldForSearch(name);
        if (!words.every((word) => folded.includes(word))) continue;
        candidates.push(
          FoodCandidate.parse({
            name,
            origin: this.id,
            sourceRef: `${this.id}:${entry.id}`,
            carbsPer100g: entry.carbsPer100g,
            portions: [],
          }),
        );
        if (candidates.length === 10) break;
      }
      return { status: "ok", candidates };
    } catch {
      this.entries = undefined;
      return { status: signal.aborted ? "timeout" : "error", candidates: [] };
    }
  }
}
