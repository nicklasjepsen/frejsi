import type { Locale } from "../../schemas/settings";
import { FoodCandidate } from "../../schemas/food";
import { fridaCategory } from "../category/index";
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
  /** `frida:<id>` read from the dataset: the one place a Frida pick's category is decided. */
  async byRef(sourceRef: string, locale: Locale, signal: AbortSignal): Promise<FoodCandidate | null> {
    const match = /^frida:(\d+)$/.exec(sourceRef);
    if (!match || cancelled(signal)) return null;
    const id = Number(match[1]);
    try {
      const entries = await this.loaded();
      signal.throwIfAborted();
      const entry = entries.find((entry) => entry.id === id);
      return entry ? this.candidate(entry, locale) : null;
    } catch {
      this.entries = undefined;
      return null;
    }
  }
  private loaded(): Promise<FridaEntry[]> {
    return (this.entries ??= this.load().then((data) => FridaEntry.array().parse(data)));
  }
  private candidate(entry: FridaEntry, locale: Locale): FoodCandidate {
    const name = entry.name[locale] || entry.name[locale === "en" ? "da" : "en"];
    const category = fridaCategory(entry.group);
    return FoodCandidate.parse({
      name,
      origin: this.id,
      sourceRef: `${this.id}:${entry.id}`,
      carbsPer100g: entry.carbsPer100g,
      portions: [],
      ...(category ? { category } : {}),
    });
  }
  async search(q: string, locale: Locale, signal: AbortSignal): Promise<FoodSourceResult> {
    if (cancelled(signal)) return { status: "timeout", candidates: [] };
    const words = foldForSearch(q).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return { status: "ok", candidates: [] };
    try {
      const entries = await this.loaded();
      signal.throwIfAborted();
      const candidates: FoodCandidate[] = [];
      for (const entry of entries) {
        const candidate = this.candidate(entry, locale);
        const folded = foldForSearch(candidate.name);
        if (!words.every((word) => folded.includes(word))) continue;
        candidates.push(candidate);
        if (candidates.length === 10) break;
      }
      return { status: "ok", candidates };
    } catch {
      this.entries = undefined;
      return { status: signal.aborted ? "timeout" : "error", candidates: [] };
    }
  }
}
