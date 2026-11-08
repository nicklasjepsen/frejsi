import { mgdlToMmol } from "../../glucose/units";
import type { LiveLanguage, LiveUnit } from "../../schemas/live";
import da from "./da.json";
import en from "./en.json";

/**
 * The push relay's notification copy (plan 2026-11-08-ios-follower-app §1, §4), in the
 * subscription's language. A value always carries its age; nothing here is about insulin (the
 * dosing test scans this folder).
 */
const messages: Record<LiveLanguage, typeof da> = { da, en };

export type LiveAlertKind = "low" | "high" | "stale";

export interface LiveAlertText {
  title: string;
  body: string;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** "3,6" in Danish, "3.6" in English for mmol/L; a whole number for mg/dL. */
export function formatLiveValue(mgdl: number, unit: LiveUnit, language: LiveLanguage): string {
  if (unit === "mgdL") return String(Math.round(mgdl));
  const text = mgdlToMmol(mgdl).toFixed(1);
  return language === "da" ? text.replace(".", ",") : text;
}

/** "2 min siden" / "2 min ago"; under a minute is "lige nu" / "just now". */
export function formatLiveAge(ageMs: number, language: LiveLanguage): string {
  const minutes = Math.max(0, Math.floor(ageMs / 60_000));
  const age = messages[language].age;
  return minutes === 0 ? age.now : fill(age.minutes, { minutes: String(minutes) });
}

/** A low or high alert for a reading `ageMs` old, or the no-new-readings alert. */
export function liveAlertText(
  language: LiveLanguage,
  alert:
    | { kind: "low" | "high"; mgdl: number; unit: LiveUnit; ageMs: number }
    | { kind: "stale"; ageMs: number },
): LiveAlertText {
  const copy = messages[language].alert;
  if (alert.kind === "stale") {
    const minutes = String(Math.max(0, Math.floor(alert.ageMs / 60_000)));
    return { title: fill(copy.stale, { minutes }), body: copy.body };
  }
  const title = fill(copy[alert.kind], {
    value: formatLiveValue(alert.mgdl, alert.unit, language),
    unit: alert.unit === "mgdL" ? "mg/dL" : "mmol/L",
    age: formatLiveAge(alert.ageMs, language),
  });
  return { title, body: copy.body };
}

/** The alert iOS requires with a push-to-start; it carries no value. */
export function liveRestartText(language: LiveLanguage): LiveAlertText {
  return { ...messages[language].restart };
}
