"use client";
import {
  DEFAULT_SYMPTOM_KINDS,
  type SpaceSymptomKind,
  type SymptomKind,
} from "@frejsi/shared/schemas/symptom";
import { useTranslations } from "next-intl";
import type { AppLocale } from "@/lib/i18n/routing";

/** A kind's name on screen: the namespace for the six defaults, the space's own label otherwise. */
export function useKindLabel(locale: AppLocale, spaceKinds: readonly SpaceSymptomKind[]) {
  const t = useTranslations("symptoms.kinds");
  return (kind: SymptomKind): string => {
    if ((DEFAULT_SYMPTOM_KINDS as readonly string[]).includes(kind)) return t(kind);
    const own = spaceKinds.find((entry) => entry.id === kind);
    return own ? own.label[locale] : kind.replace(/^custom:/, "");
  };
}
export const ALL_KINDS = (spaceKinds: readonly SpaceSymptomKind[]): SymptomKind[] => [
  ...DEFAULT_SYMPTOM_KINDS,
  ...spaceKinds.map((entry) => entry.id),
];
