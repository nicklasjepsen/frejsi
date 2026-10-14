/**
 * App Insights for web and poller (plan §9). The initializer strips request bodies and every
 * property on the PII list before anything leaves the process. The SDK is loaded only when a
 * connection string is set, so tests and local dev never touch it.
 */
export const PII_PROPERTY_NAMES = [
  "name",
  "email",
  "username",
  "password",
  "mmol",
  "photo",
] as const;
const BODY_PROPERTY_NAMES = ["body", "requestbody", "responsebody"];

/** The slice of the SDK's `TelemetryItem` the initializer touches. */
export interface TelemetryEnvelope {
  data?: {
    baseType?: string;
    baseData?: {
      body?: unknown;
      properties?: Record<string, unknown>;
      measurements?: Record<string, unknown>;
      [key: string]: unknown;
    };
  };
}

const isPii = (key: string) =>
  (PII_PROPERTY_NAMES as readonly string[]).includes(key.toLowerCase()) ||
  BODY_PROPERTY_NAMES.includes(key.toLowerCase());

function stripRecord(record: Record<string, unknown> | undefined): void {
  if (!record) return;
  for (const key of Object.keys(record)) {
    if (isPii(key)) Reflect.deleteProperty(record, key);
  }
}

/** Telemetry processor: mutates in place, always keeps the item (returns true). */
export function stripPii(envelope: TelemetryEnvelope): boolean {
  const baseData = envelope.data?.baseData;
  if (!baseData) return true;
  delete baseData.body;
  stripRecord(baseData.properties);
  stripRecord(baseData.measurements);
  return true;
}

export interface TelemetryClientLike {
  trackEvent(event: { name: string; properties?: Record<string, string> }): void;
}

let client: TelemetryClientLike | null = null;
let starting: Promise<void> | null = null;

/**
 * Starts the SDK once when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set. Safe to call from
 * `instrumentation.ts` (web) and the Functions entry (poller).
 */
export function startTelemetry(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const connectionString = env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString || client) return Promise.resolve();
  starting ??= (async () => {
    const appInsights = await import("applicationinsights");
    appInsights.setup(connectionString).start();
    appInsights.defaultClient.addTelemetryProcessor((item) => stripPii(item));
    client = appInsights.defaultClient;
  })();
  return starting;
}

/** A custom event with string properties; the PII list is applied here too. */
export function trackEvent(name: string, properties: Record<string, string> = {}): void {
  if (!client) return;
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!isPii(key)) clean[key] = value;
  }
  client.trackEvent({ name, properties: clean });
}

/** Tests only. */
export function _resetTelemetryForTests(fake: TelemetryClientLike | null): void {
  client = fake;
  starting = null;
}
