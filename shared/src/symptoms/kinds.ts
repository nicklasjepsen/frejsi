import { z } from "zod";
import {
  DEFAULT_SYMPTOM_KINDS,
  SpaceSymptomKind,
  type DefaultSymptomKind,
  type SymptomKind,
} from "../schemas/symptom";
import type { Locale } from "../schemas/settings";

import da from "./labels/da.json";
import en from "./labels/en.json";

/**
 * The names of the six default kinds, the same words the push uses; the picker has its own copy in
 * `web/messages/<locale>/symptoms.json`. The two JSON files are the data: code here is English.
 */
export const DEFAULT_KIND_LABELS: Record<DefaultSymptomKind, Record<Locale, string>> =
  Object.fromEntries(
    DEFAULT_SYMPTOM_KINDS.map((kind) => [kind, { da: da[kind], en: en[kind] }]),
  ) as Record<DefaultSymptomKind, Record<Locale, string>>;

function isDefault(kind: string): kind is DefaultSymptomKind {
  return (DEFAULT_SYMPTOM_KINDS as readonly string[]).includes(kind);
}

/** The label of a kind: a default's name, a space kind's label, else the slug after `custom:`. */
export function symptomKindLabel(
  kind: SymptomKind,
  locale: Locale,
  spaceKinds: readonly SpaceSymptomKind[] = [],
): string {
  if (isDefault(kind)) return DEFAULT_KIND_LABELS[kind][locale];
  const own = spaceKinds.find((entry) => entry.id === kind);
  return own ? own.label[locale] : kind.replace(/^custom:/, "");
}

/** A default kind, or a custom kind the space has declared. */
export function isKnownKind(kind: string, spaceKinds: readonly SpaceSymptomKind[]): boolean {
  return isDefault(kind) || spaceKinds.some((entry) => entry.id === kind);
}

/** `Space.symptomKinds` as stored; anything unreadable counts as no custom kinds. */
export function parseSpaceKinds(raw: string | null | undefined): SpaceSymptomKind[] {
  if (!raw) return [];
  try {
    const parsed = z.array(SpaceSymptomKind).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
