// Provider implementations and the fake are available only through the registry.
export type {
  AiProvider,
  AiMessage,
  AiContent,
  AiCapabilities,
  AiUse,
  CompleteRequest,
  VisionRequest,
  EmbedRequest,
  EmbedResult,
  CompleteResult,
  ToolCall,
  ToolDefinition,
} from "./types";
export type { AiCallRepository, AiCallRow, AiCallKind, AiCallWindow, ReserveAiCall } from "./calls";
export { PrismaAiCallRepository, type AiCallDb } from "./calls-prisma";
export { CappedAiProvider, type CappedAiOptions } from "./capped";
export { aiProviders, type AiProviderRegistry } from "./registry";
export { runToolLoop, type ToolHandlers } from "./tool-loop";
export { assertNoDosing } from "./guard";
export { parseRecipe, type ParsedRecipe, type RecipeInput } from "./recipe/parse";
export { extractText, parseIngredientLine, parseYield, readJsonLd } from "./recipe/jsonld";
export {
  NO_CARB_STAPLES,
  gramsFor,
  isNoCarbStaple,
  lineFor,
  resolveIngredients,
  type RecipeLookup,
  type ResolvedLine,
} from "./recipe/ingredients";
export { computeRecipe, type PortionLabels, type RecipeTotals } from "./recipe/compute";
export {
  SYMPTOM_EXPLANATION_PHRASES,
  assertNoSymptomExplanation,
  findSymptomExplanation,
} from "./insight/guard";
