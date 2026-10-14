/**
 * App Insights for web and poller (plan §9). PII is stripped by two OpenTelemetry processors
 * registered through `useAzureMonitor`, the supported hook in applicationinsights 3.x (the old
 * `addTelemetryProcessor` is a no-op there). Every span (request, dependency) and every log
 * record (trace, exception, custom event) passes through them before the exporter sees it.
 * The SDK is loaded only when a connection string is set, so tests and local dev never touch it.
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

const isPii = (key: string) => {
  const leaf = key.toLowerCase().split(".").at(-1) ?? "";
  return (
    (PII_PROPERTY_NAMES as readonly string[]).includes(leaf) || BODY_PROPERTY_NAMES.includes(leaf)
  );
};

/** Removes PII keys from a mutable attribute bag in place. */
export function stripPii(record: Record<string, unknown> | undefined): void {
  if (!record) return;
  for (const key of Object.keys(record)) {
    if (isPii(key)) Reflect.deleteProperty(record, key);
  }
}

/** The slices of OpenTelemetry's `Span` / `ReadableSpan` and `SdkLogRecord` the processors touch. */
export interface SpanLike {
  readonly attributes: Record<string, unknown>;
}
export interface LogRecordLike {
  readonly attributes: Record<string, unknown>;
  body?: unknown;
}

/** Requests and dependencies: strips PII-named attributes when the span is recorded. */
export const piiSpanProcessor = {
  onStart(span: SpanLike): void {
    stripPii(span.attributes);
  },
  onEnd(span: SpanLike): void {
    stripPii(span.attributes);
  },
  forceFlush: (): Promise<void> => Promise.resolve(),
  shutdown: (): Promise<void> => Promise.resolve(),
};

/** Traces, exceptions and custom events: strips PII from the attributes and the body's bags. */
export const piiLogRecordProcessor = {
  onEmit(record: LogRecordLike): void {
    stripPii(record.attributes);
    const body = record.body;
    if (typeof body === "object" && body !== null) {
      const bag = body as Record<string, unknown>;
      stripPii(bag.properties as Record<string, unknown> | undefined);
      stripPii(bag.measurements as Record<string, unknown> | undefined);
      for (const key of ["body", "requestBody", "responseBody"]) Reflect.deleteProperty(bag, key);
    }
  },
  forceFlush: (): Promise<void> => Promise.resolve(),
  shutdown: (): Promise<void> => Promise.resolve(),
};

export interface EventLogger {
  emit(record: { attributes: Record<string, string>; body: Record<string, string | number> }): void;
}

/** What `startTelemetry` needs from the SDK; the default loads applicationinsights lazily. */
export interface TelemetrySdk {
  useAzureMonitor(options: {
    azureMonitorExporterOptions: { connectionString: string };
    spanProcessors: (typeof piiSpanProcessor)[];
    logRecordProcessors: (typeof piiLogRecordProcessor)[];
  }): void;
  getLogger(name: string): EventLogger;
}

async function loadSdk(): Promise<TelemetrySdk> {
  const [appInsights, { logs }] = await Promise.all([
    import("applicationinsights"),
    import("@opentelemetry/api-logs"),
  ]);
  return {
    useAzureMonitor: (options) => {
      appInsights.useAzureMonitor(options);
    },
    getLogger: (name) => {
      const otelLogger = logs.getLogger(name);
      return {
        emit: (record) => {
          otelLogger.emit(record);
        },
      };
    },
  };
}

let logger: EventLogger | null = null;
let starting: Promise<void> | null = null;

/**
 * Starts the SDK once when `APPLICATIONINSIGHTS_CONNECTION_STRING` is set. Safe to call from
 * `instrumentation.ts` (web) and the Functions entry (poller).
 */
export function startTelemetry(
  env: NodeJS.ProcessEnv = process.env,
  sdk: () => Promise<TelemetrySdk> = loadSdk,
): Promise<void> {
  const connectionString = env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString || logger) return Promise.resolve();
  starting ??= (async () => {
    const loaded = await sdk();
    loaded.useAzureMonitor({
      azureMonitorExporterOptions: { connectionString },
      spanProcessors: [piiSpanProcessor],
      logRecordProcessors: [piiLogRecordProcessor],
    });
    logger = loaded.getLogger("frejsi");
  })();
  return starting;
}

/**
 * A custom event with string properties, in the shape the SDK's own `trackEvent` emits, so the
 * exporter maps it to an App Insights customEvent. The PII list is applied here as well as in
 * the processor.
 */
export function trackEvent(name: string, properties: Record<string, string> = {}): void {
  if (!logger) return;
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!isPii(key)) clean[key] = value;
  }
  logger.emit({
    attributes: { ...clean, "_MS.baseType": "EventData" },
    body: { name, version: 2 },
  });
}

/** Tests only. */
export function _resetTelemetryForTests(fake: EventLogger | null): void {
  logger = fake;
  starting = null;
}
