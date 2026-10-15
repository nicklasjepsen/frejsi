/**
 * Next.js calls `register` once per server start. App Insights is started through the shared
 * initializer, which strips PII and is a no-op without a connection string (plan §9). The whole
 * body sits inside the runtime check so the edge compilation (the middleware's) drops the import:
 * `NEXT_RUNTIME` is a compile-time constant and the SDK cannot be bundled for the edge.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTelemetry } = await import("@frejsi/shared");
    await startTelemetry();
  }
}
