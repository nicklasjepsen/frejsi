import { z } from "zod";

/** Narrow visibility adapter until the full AI settings lane's usage route is available. */
export const ParseAvailability = z.strictObject({ enabled: z.boolean() });
