import { z } from "zod";

// How the person felt (v0.6.0 plan §4). A symptom carries a kind, a time and at most a severity and
// a note: never a glucose value, so every member of the space, a viewer included, may read it.

/** The six kinds every space has; a space may add `custom:<slug>` kinds (`Space.symptomKinds`). */
export const DEFAULT_SYMPTOM_KINDS = [
  "stomach-ache",
  "dizzy",
  "nausea",
  "tired",
  "headache",
  "shaky",
] as const;
export type DefaultSymptomKind = (typeof DEFAULT_SYMPTOM_KINDS)[number];
/** `custom:` plus a slug; 40 characters in all, the width of `Symptom.kind`. */
const CUSTOM_KIND = /^custom:[a-z0-9][a-z0-9-]{0,32}$/;
export const SymptomKind = z
  .string()
  .refine(
    (value) =>
      (DEFAULT_SYMPTOM_KINDS as readonly string[]).includes(value) || CUSTOM_KIND.test(value),
    "Unknown symptom kind",
  );
export type SymptomKind = z.infer<typeof SymptomKind>;

export const Severity = z.enum(["light", "medium", "strong"]);
export type Severity = z.infer<typeof Severity>;

/** One entry of `Space.symptomKinds`: a custom kind with its name in both languages. */
export const SpaceSymptomKind = z.strictObject({
  id: z.string().regex(CUSTOM_KIND),
  label: z.strictObject({
    da: z.string().trim().min(1).max(40),
    en: z.string().trim().min(1).max(40),
  }),
});
export type SpaceSymptomKind = z.infer<typeof SpaceSymptomKind>;

const MINUTE_MS = 60_000;
const AHEAD_MS = 10 * MINUTE_MS;
const BEHIND_MS = 7 * 24 * 60 * MINUTE_MS;
/** Not more than 10 minutes ahead of now, not older than 7 days: a feeling is logged as it happens. */
const timestamp = z.iso.datetime().refine((value) => {
  const offset = Date.parse(value) - Date.now();
  return offset <= AHEAD_MS && offset >= -BEHIND_MS;
}, "Symptom time is outside the window");
const note = z.string().trim().max(500);

export const CreateSymptomRequest = z.strictObject({
  kind: SymptomKind,
  ts: timestamp.default(() => new Date().toISOString()),
  severity: Severity.optional(),
  note: note.optional(),
});
export type CreateSymptomRequest = z.infer<typeof CreateSymptomRequest>;
export const UpdateSymptomRequest = z
  .strictObject({
    kind: SymptomKind,
    ts: timestamp,
    severity: Severity,
    note,
    // Omitted means unchanged; null explicitly clears the resolved time.
    resolvedTs: z.iso.datetime().nullable(),
  })
  .partial();
export type UpdateSymptomRequest = z.infer<typeof UpdateSymptomRequest>;

export const SymptomView = z.strictObject({
  id: z.string().min(1),
  kind: SymptomKind,
  ts: z.iso.datetime(),
  severity: Severity.optional(),
  note: note.optional(),
  resolvedTs: z.iso.datetime().optional(),
  byUserId: z.string().min(1),
  byName: z.string().min(1),
});
export type SymptomView = z.infer<typeof SymptomView>;
export const SymptomsView = z.strictObject({ symptoms: z.array(SymptomView) });
export type SymptomsView = z.infer<typeof SymptomsView>;

const RANGE_MS = 8 * 24 * 60 * MINUTE_MS;
/** `GET symptoms?from&to`: at most eight days, so a week view and its margins fit in one read. */
export const SymptomRangeQuery = z
  .strictObject({ from: z.iso.datetime(), to: z.iso.datetime() })
  .refine((value) => {
    const span = Date.parse(value.to) - Date.parse(value.from);
    return span >= 0 && span <= RANGE_MS;
  }, "Range must be at most eight days");
export type SymptomRangeQuery = z.infer<typeof SymptomRangeQuery>;
