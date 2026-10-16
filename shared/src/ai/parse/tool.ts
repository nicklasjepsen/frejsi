import { z } from "zod";
import type { ToolDefinition } from "../types";

export const LookupInput = z.strictObject({ query: z.string().trim().min(1).max(80) });
export const lookupTool: ToolDefinition = {
  name: "lookup",
  description: "find a food in this family's library, the shared cache and the configured sources",
  inputSchema: LookupInput,
};
