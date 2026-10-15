// Public surface of @frejsi/shared. Append-only after task 1 (plan §2): add lines, never reorder.
// The in-memory fakes are deliberately not here; tests, the seed and the CLI import them by path.

export * from "./schemas/index";

export type { GlucoseSource } from "./glucose/types";
export { MGDL_PER_MMOL, fromMmol, mgdlToMmol, mmolToMgdl } from "./glucose/units";

export type { ClientToken, ClientTokenRequest, EventSink, LiveTokenIssuer } from "./events/types";
export {
  configureEmit,
  createEmit,
  emit,
  groupFor,
  type EmitDb,
  type EmitDeps,
  type EmitFn,
  type EmitTx,
} from "./events/emit";
export {
  DEFAULT_HUB,
  NoopEventSink,
  WebPubSubEventSink,
  createEventSinkFromEnv,
} from "./events/pubsub";

export type { Secrets } from "./secrets/types";
export { glucoseSecretName } from "./secrets/types";
export { KeyVaultSecrets, createSecretsFromEnv } from "./secrets/keyvault";

export { prisma, type PrismaClient } from "./db/client";

export { LOG_KEYS, createLogger, log, type LogFields, type LogKey, type Logger } from "./log";
export {
  PII_PROPERTY_NAMES,
  piiLogRecordProcessor,
  piiSpanProcessor,
  startTelemetry,
  stripPii,
  trackEvent,
} from "./telemetry";

export {
  DOSING_ALLOW_LIST,
  DOSING_WORDS,
  findDosingVocabulary,
  type DosingFinding,
} from "./dosing-vocabulary";

export {
  DexcomShareCredential,
  DexcomShareError,
  DexcomShareSource,
  parseCredential,
  serializeCredential,
  type DexcomShareSourceOptions,
  type FetchLike,
} from "./glucose/dexcom-share/index";
export {
  FAILURES_BEFORE_DISCONNECTED,
  FIRST_RUN_MINUTES,
  WINDOW_MINUTES,
  runPollCycle,
  sinceFor,
  type PollCycleDeps,
  type PollCycleOptions,
  type PollDb,
  type PollOutcomeCode,
  type PollSpaceRow,
  type SourceFactory,
  type SpaceOutcome,
} from "./glucose/poll-cycle";
export { CREDENTIAL_RETRY_MS } from "./glucose/dexcom-share/index";
export type { LiveGroupRevoker } from "./events/types";
export * from "./schemas/food";
export * from "./schemas/meal";
export { normaliseBarcode } from "./food/barcode";
export { foldForSearch } from "./food/search";
export { carbsFor } from "./food/portions";
export type {
  FoodRepository,
  FoodSource,
  FoodSourceResult,
  CacheFoodInput,
  LibraryOptions,
} from "./food/types";
export { lookup, type LookupOptions } from "./food/lookup";
export { PrismaFoodRepository } from "./food/repository";
export { dayRange } from "./meals/day-range";
export { mealTitle, mealSlot } from "./meals/title";
