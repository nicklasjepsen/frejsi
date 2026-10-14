import { app } from "@azure/functions";
import { log, startTelemetry } from "@frejsi/shared";

// Azure Functions v4 programming model: `package.json#main` is `dist/{index,functions/*}.js`, so
// each file under src/functions/ registers its own trigger (poll.ts, source-connect.ts) and this
// entry only sets up what every function shares.
app.setup({ enableHttpStream: false });

// Telemetry is optional: a failure to start it is logged, never an unhandled rejection that takes
// the Function App down with it.
startTelemetry().catch((error: unknown) => {
  log.warn("telemetry.start-failed", { code: error instanceof Error ? error.name : "unknown" });
});
