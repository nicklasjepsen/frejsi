/**
 * The unbuilt destinations the navigation links to (decision 15); the URL slug is the key. Kept
 * out of the client component so server pages can validate a slug: a function exported from a
 * "use client" module is a client reference on the server and cannot be called there.
 */
export const SOON_FEATURES = [
  "meals",
  "food",
  "history",
  "my-food",
  "ask",
  "today",
  "earlier-days",
] as const;
export type SoonFeature = (typeof SOON_FEATURES)[number];

export function isSoonFeature(value: string): value is SoonFeature {
  return (SOON_FEATURES as readonly string[]).includes(value);
}
