import { z } from "zod";

/** `/api/health`: a coarse state, no timestamp and no value (plan §4, decision 22). */
export const Health = z.object({
  ok: z.boolean(),
  version: z.string(),
  db: z.enum(["ok", "error"]),
  readings: z.enum(["fresh", "stale", "none"]),
});
export type Health = z.infer<typeof Health>;
