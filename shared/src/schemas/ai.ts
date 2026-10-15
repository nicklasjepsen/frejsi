import { z } from "zod";
import { FoodCandidate, FoodOrigin, FoodView, Portion } from "./food";
import { GlucoseUnit } from "./glucose";
import { InRange } from "./history";
import { MealSlot } from "./meal";
import { Locale } from "./settings";

const count = z.number().int().nonnegative();
const percent = z.number().min(0).max(100);
const text = z.string().trim().min(1);
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const peak = z.strictObject({ mmol: z.number().min(0).max(40), minutesAfterMeal: count });
const state = z.enum(["ready", "pending", "off", "cap", "unavailable"]);
const questions = z.array(z.string().min(10).max(240)).max(5);
const photoDataUrl = z
  .string()
  .max(8_000_000)
  .regex(/^data:image\/jpeg;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  .refine((value) => value.length > "data:image/jpeg;base64,".length);

export const AiProviderId = z.enum(["anthropic", "azure-openai", "ollama"]);
export type AiProviderId = z.infer<typeof AiProviderId>;
export const ModelRole = z.enum(["small", "everyday", "insight", "embed"]);
export type ModelRole = z.infer<typeof ModelRole>;
export const EstimatedItem = z.strictObject({
  name: text.max(120),
  grams: z.number().min(1).max(2000).optional(),
  carbs: count.max(500),
  confidence: z.enum(["low", "medium", "high"]),
  approx: z.literal(true),
});
export type EstimatedItem = z.infer<typeof EstimatedItem>;
export const ParsedItem = z
  .strictObject({
    query: text.max(500),
    match: z
      .strictObject({
        source: FoodOrigin,
        food: z.union([FoodView, FoodCandidate]),
        portionLabel: text.max(40).optional(),
        grams: z.number().min(1).max(5000).optional(),
      })
      .optional(),
    estimate: EstimatedItem.optional(),
  })
  .refine(
    (value) => (value.match !== undefined) !== (value.estimate !== undefined),
    "Exactly one match or estimate is required",
  );
export type ParsedItem = z.infer<typeof ParsedItem>;
export const ParsedMeal = z.strictObject({
  items: z.array(ParsedItem).max(12),
  unmatched: z.array(text.max(500)).max(12),
});
export type ParsedMeal = z.infer<typeof ParsedMeal>;
export const PhotoEstimate = z.strictObject({
  items: z.array(EstimatedItem).min(1).max(10),
  totalCarbs: count.max(5000),
  dishName: text.max(80),
  approx: z.literal(true),
});
export type PhotoEstimate = z.infer<typeof PhotoEstimate>;
export const NormalisedFood = z.strictObject({
  name: text.max(120),
  portions: z.array(Portion).max(4),
});
export type NormalisedFood = z.infer<typeof NormalisedFood>;
export const InsightStats = z.strictObject({
  peak: peak.optional(),
  inRange: InRange,
  leadMinutes: z.number().int().optional(),
  readingCount: count,
});
export type InsightStats = z.infer<typeof InsightStats>;
export const InsightNumbers = z.strictObject({
  inRangePercent: percent.optional(),
  previousWeekInRangePercent: percent.optional(),
  belowPercent: percent.optional(),
  lowEpisodes: z.strictObject({ count, atNight: count }),
  carbsPerDay: count,
  mealCount: count,
  lead: z.strictObject({ meanMinutes: z.number().int().optional(), registered: count, of: count }),
});
export type InsightNumbers = z.infer<typeof InsightNumbers>;
export const InsightInput = z.strictObject({
  locale: Locale,
  glucoseUnit: GlucoseUnit,
  meal: z.strictObject({ title: text.max(200), totalCarbs: count, slot: MealSlot, localTime }),
  stats: InsightStats,
  previous: z
    .array(z.strictObject({ localDate: z.iso.date(), totalCarbs: count, stats: InsightStats }))
    .max(5),
  leadLabel: z.enum(["before", "after", "none"]),
});
export type InsightInput = z.infer<typeof InsightInput>;
export const WeekInsightInput = z.strictObject({
  locale: Locale,
  glucoseUnit: GlucoseUnit,
  isoWeek: z.number().int().min(1).max(53),
  weekStart: z.iso.date(),
  numbers: InsightNumbers,
  days: z
    .array(
      z.strictObject({
        localDate: z.iso.date(),
        mealCount: count,
        totalCarbs: count,
        inRangePercent: percent.optional(),
      }),
    )
    .length(7),
  meals: z
    .array(
      z.strictObject({
        localDate: z.iso.date(),
        localTime,
        title: text.max(200),
        totalCarbs: count,
        peak: peak.optional(),
        inRangePercent: percent.optional(),
        leadMinutes: z.number().int().optional(),
      }),
    )
    .max(40),
});
export type WeekInsightInput = z.infer<typeof WeekInsightInput>;
export const MealInsight = z.strictObject({ text: z.string().min(20).max(280) });
export type MealInsight = z.infer<typeof MealInsight>;
export const WeekInsight = z.strictObject({ summary: z.string().min(20).max(600), questions });
export type WeekInsight = z.infer<typeof WeekInsight>;
export const MealInsightView = z.strictObject({
  state,
  text: MealInsight.shape.text.optional(),
  createdAt: z.iso.datetime().optional(),
  model: text.max(80).optional(),
});
export type MealInsightView = z.infer<typeof MealInsightView>;
export const WeekInsightView = z.strictObject({
  state,
  summary: WeekInsight.shape.summary.optional(),
  questions: questions.optional(),
  questionsEdited: z.boolean(),
  rejectedCount: count,
  createdAt: z.iso.datetime().optional(),
  readyAt: z.iso.datetime().optional(),
});
export type WeekInsightView = z.infer<typeof WeekInsightView>;
export const AiUsage = z.strictObject({
  enabled: z.boolean(),
  provider: AiProviderId.optional(),
  providers: z.array(
    z.strictObject({
      id: AiProviderId,
      configured: z.boolean(),
      capabilities: z.strictObject({
        complete: z.boolean(),
        vision: z.boolean(),
        embed: z.boolean(),
      }),
    }),
  ),
  callsToday: count,
  dailyCap: count,
  embedCallsToday: count,
  embedDailyCap: count,
  pushPublicKey: text.optional(),
});
export type AiUsage = z.infer<typeof AiUsage>;
export const ParseRequest = z.strictObject({ text: text.max(500) });
export type ParseRequest = z.infer<typeof ParseRequest>;
export const EstimateRequest = z.strictObject({ photoDataUrl });
export type EstimateRequest = z.infer<typeof EstimateRequest>;
export const AskRequest = z.strictObject({ estimate: PhotoEstimate, photoDataUrl });
export type AskRequest = z.infer<typeof AskRequest>;
export const UpdateInsightRequest = z.strictObject({ questions });
export type UpdateInsightRequest = z.infer<typeof UpdateInsightRequest>;
export const PushSubscriptionRequest = z.strictObject({
  spaceId: text,
  subscription: z.strictObject({
    endpoint: z.url().startsWith("https://").max(1000),
    keys: z.strictObject({ p256dh: text.max(200), auth: text.max(100) }),
  }),
});
export type PushSubscriptionRequest = z.infer<typeof PushSubscriptionRequest>;
// Writable v0.1 settings fields plus AI opt-in; read-only settings never enter a patch.
const target = z
  .number()
  .min(0)
  .max(40)
  .refine((value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-6);
export const UpdateSpaceSettingsRequest = z
  .strictObject({
    glucoseUnit: GlucoseUnit.optional(),
    targetLow: target.optional(),
    targetHigh: target.optional(),
    aiEnabled: z.boolean().optional(),
    aiProvider: AiProviderId.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), "Nothing to change")
  .refine(
    (value) =>
      value.targetLow === undefined ||
      value.targetHigh === undefined ||
      value.targetLow < value.targetHigh,
    "Target bounds are reversed",
  );
export type UpdateSpaceSettingsRequest = z.infer<typeof UpdateSpaceSettingsRequest>;
