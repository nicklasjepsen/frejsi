import { z } from "zod";
import { FoodCandidate, Portion } from "../../schemas/food";
import type { Locale } from "../../schemas/settings";
import { normaliseBarcode } from "../barcode";
import { offCategory } from "../category/index";
import { carbsFor } from "../portions";

const Product = z.looseObject({
  code: z.union([z.string(), z.number()]).transform(String),
  product_name: z.string().optional(),
  product_name_da: z.string().optional(),
  product_name_en: z.string().optional(),
  brands: z.string().optional(),
  // A string or anything else than a list of tags is ignored, never a reason to drop the product.
  categories_tags: z.array(z.string()).catch([]),
  nutriments: z.looseObject({ carbohydrates_100g: z.unknown().optional() }).optional(),
  serving_size: z.string().optional(),
  serving_quantity: z.unknown().optional(),
  serving_quantity_unit: z.string().optional(),
});
function numeric(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
/** Never infer a mass from a volume: density is not supplied by this API. */
export function mapProduct(raw: unknown, locale: Locale): FoodCandidate | null {
  const parsed = Product.safeParse(raw);
  if (!parsed.success) return null;
  const p = parsed.data;
  const barcode = normaliseBarcode(p.code);
  if (!barcode) return null;
  const translated = p[`product_name_${locale}`]?.trim();
  const name = translated?.length ? translated : p.product_name?.trim();
  if (!name) return null;
  const brand = p.brands?.trim();
  const rawCarbs = numeric(p.nutriments?.carbohydrates_100g);
  const carbsPer100g =
    rawCarbs !== null && rawCarbs >= 0 && rawCarbs <= 100 ? Math.round(rawCarbs * 10) / 10 : null;
  const portions: Portion[] = [];
  const label = p.serving_size?.trim();
  const unit = p.serving_quantity_unit?.toLowerCase();
  const mass = label?.match(/(?:^|[\s(])(\d+(?:[.,]\d+)?)\s*g\b/i);
  const quantity = numeric(p.serving_quantity);
  const grams =
    unit === "g"
      ? (quantity ?? (mass ? Number(mass[1]?.replace(",", ".")) : null))
      : !unit && mass
        ? (quantity ?? Number(mass[1]?.replace(",", ".")))
        : null;
  if (label && grams !== null && grams >= 1 && grams <= 5000 && carbsPer100g !== null) {
    const portion = Portion.safeParse({ label, grams, carbs: carbsFor({ carbsPer100g }, grams) });
    if (portion.success) portions.push(portion.data);
  }
  const category = offCategory(p.categories_tags);
  const candidate = FoodCandidate.safeParse({
    name: brand ? `${name}, ${brand}` : name,
    origin: "off",
    sourceRef: `off:${barcode}`,
    barcode,
    carbsPer100g,
    portions,
    ...(category ? { category } : {}),
  });
  return candidate.success ? candidate.data : null;
}
