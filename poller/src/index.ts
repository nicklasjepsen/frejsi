import { app } from "@azure/functions";
import { log, startTelemetry } from "@naensom/shared";

// Azure Functions v4 programming model. The function modules register themselves on import,
// and everything is one esbuild bundle (dist/index.js), so they share a single copy of
// @naensom/shared: the telemetry started below is the one the timer tracks reading.stored through,
// and there is one Prisma client. app.setup() may run after registration; only startup is final.
import "./functions/poll";
import "./functions/pump-poll";
import "./functions/source-connect";
import "./functions/weekly-insight";
import "./functions/enrich-foods";
import "./functions/live-poll";
import "./functions/live-register";

app.setup({ enableHttpStream: false });

// Telemetry is optional: a failure to start it is logged, never an unhandled rejection that takes
// the Function App down with it.
startTelemetry().catch((error: unknown) => {
  log.warn("telemetry.start-failed", { code: error instanceof Error ? error.name : "unknown" });
});
