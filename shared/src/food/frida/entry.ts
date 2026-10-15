import { z } from "zod";

export const FridaEntry = z.strictObject({
  id: z.number().int().positive(),
  name: z
    .strictObject({ da: z.string().max(200), en: z.string().max(200) })
    .refine((name) => Boolean(name.da || name.en)),
  carbsPer100g: z.number().min(0).max(100).multipleOf(0.1),
  group: z.string(),
});
export type FridaEntry = z.infer<typeof FridaEntry>;
