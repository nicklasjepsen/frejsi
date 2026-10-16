import { z } from "zod";

import { normaliseBarcode } from "../food/barcode";
import { foldForSearch } from "../food/search";

export const Portion = z.strictObject({
  label: z.string().min(1).max(40),
  grams: z.number().min(1).max(5000).optional(),
  carbs: z.number().int().min(0).max(1000),
});
export type Portion = z.infer<typeof Portion>;

export const family = "family";
export const manual = "manual";
export const ai = "ai";
export const FoodOrigin = z.string().regex(/^[a-z][a-z0-9-]{0,19}$/);
export type FoodOrigin = z.infer<typeof FoodOrigin>;

const barcode = z.string().transform((value, ctx) => {
  const normalised = normaliseBarcode(value);
  if (normalised === null) {
    ctx.addIssue({ code: "custom", message: "Invalid barcode checksum" });
    return z.NEVER;
  }
  return normalised;
});
const fields = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine(
      (value) => foldForSearch(value).length <= 200,
      "Folded food name must be at most 200 characters",
    ),
  carbsPer100g: z.number().min(0).max(100).multipleOf(0.1).nullish(),
  portions: z.array(Portion).default([]),
  barcode: barcode.optional(),
};
const hasCarbs = (value: { carbsPer100g?: number | null | undefined; portions: Portion[] }) =>
  value.carbsPer100g != null || value.portions.length > 0;
const nutritionError = {
  message: "A food needs carbsPer100g or at least one portion",
  path: ["portions"],
};
export const FoodPhoto = z.strictObject({ thumbUrl: z.url(), originalUrl: z.url() });

export const FoodCandidate = z.strictObject({
  ...fields,
  origin: FoodOrigin,
  sourceRef: z.string().min(1).max(64),
});
export type FoodCandidate = z.infer<typeof FoodCandidate>;

const viewFields = {
  ...fields,
  id: z.string().min(1),
  origin: FoodOrigin,
  verified: z.boolean().default(false),
  verifiedBy: z.string().min(1).optional(),
  favourite: z.boolean().default(false),
  updatedAt: z.iso.datetime(),
};
export const FoodView = z.strictObject({
  ...viewFields,
  photo: FoodPhoto.optional(),
  sourceName: z.string().max(200).optional(),
  createdBy: z.strictObject({ id: z.string().min(1), name: z.string().min(1) }).optional(),
  createdAt: z.iso.datetime(),
});
export type FoodView = z.infer<typeof FoodView>;

export const Food = z
  .strictObject({
    ...viewFields,
    spaceId: z.string().min(1).nullable(),
    sourceName: z.string().max(200).nullish(),
    embeddingModel: z.string().max(80).nullish(),
    nameSearch: z.string().min(1).max(200),
    sourceRef: z.string().min(1).max(64),
    photoKey: z.string().min(1).max(200).optional(),
    verifiedAt: z.iso.datetime().optional(),
    createdBy: z.string().min(1).optional(),
    creator: z.strictObject({ id: z.string().min(1), name: z.string().min(1) }).nullish(),
    createdAt: z.iso.datetime(),
  })
  .refine((value) => value.spaceId !== null || !value.verified, "Shared cache cannot be verified")
  .refine((value) => value.spaceId === null || hasCarbs(value), nutritionError);
export type Food = z.infer<typeof Food>;

export const FoodSourceStatus = z.enum(["ok", "timeout", "error", "rate-limited", "skipped"]);
export type FoodSourceStatus = z.infer<typeof FoodSourceStatus>;
export const LookupQuery = z.union([
  z.strictObject({ q: z.string().trim().min(1).max(80), remote: z.boolean().default(true) }),
  z.strictObject({ barcode }),
]);
export type LookupQuery = z.infer<typeof LookupQuery>;

export const LookupResult = z
  .strictObject({
    source: FoodOrigin,
    verified: z.boolean().default(false),
    food: z.union([FoodView, FoodCandidate]),
  })
  .refine(
    (value) =>
      value.source === "library"
        ? "verified" in value.food && value.verified === value.food.verified
        : !value.verified && (!("verified" in value.food) || !value.food.verified),
    "Only library foods may be verified",
  );
export type LookupResult = z.infer<typeof LookupResult>;
export const LookupResponse = z.strictObject({
  results: z.array(LookupResult),
  sources: z.record(FoodOrigin, FoodSourceStatus),
  manual: z.strictObject({ name: z.string().max(80).optional(), barcode: barcode.optional() }),
});
export type LookupResponse = z.infer<typeof LookupResponse>;

export const CreateFoodRequest = z
  .strictObject({ ...fields, favourite: z.boolean().optional() })
  .refine(hasCarbs, nutritionError);
export type CreateFoodRequest = z.infer<typeof CreateFoodRequest>;
export const AddCandidateRequest = z.strictObject({
  candidate: FoodCandidate.refine(hasCarbs, nutritionError),
});
export type AddCandidateRequest = z.infer<typeof AddCandidateRequest>;
export const UpdateFoodRequest = z
  .strictObject({ ...fields, portions: z.array(Portion), favourite: z.boolean() })
  .partial()
  .refine((value) => value.carbsPer100g !== null || value.portions?.length !== 0, nutritionError);
export type UpdateFoodRequest = z.infer<typeof UpdateFoodRequest>;
export const VerifyFoodsRequest = z.strictObject({
  foodIds: z.array(z.string().min(1)).min(1).max(50),
});
export type VerifyFoodsRequest = z.infer<typeof VerifyFoodsRequest>;

/**
 * What a carer's correction sends back to the source the food came from (spec §4). Numbers and a
 * pseudonymous app reference only: no name, no photo, no person.
 */
export const FoodCorrection = z.strictObject({
  barcode,
  carbsPer100g: z.number().min(0).max(100).multipleOf(0.1).optional(),
  servingSize: z
    .strictObject({
      grams: z.number().min(1).max(5000),
      label: z.string().min(1).max(40).optional(),
    })
    .optional(),
  appRef: z.string().min(1).max(64),
});
export type FoodCorrection = z.infer<typeof FoodCorrection>;
export const ContributionResult = z.strictObject({
  status: z.enum(["ok", "bad-credentials", "rejected", "rate-limited", "error"]),
});
export type ContributionResult = z.infer<typeof ContributionResult>;
/** Plugin ids with a configured contributor. Never a credential, a host or anything glucose. */
export const ContributionsView = z.strictObject({ available: z.array(FoodOrigin) });
export type ContributionsView = z.infer<typeof ContributionsView>;
