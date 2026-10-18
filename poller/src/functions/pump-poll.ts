import { app } from "@azure/functions";
import { createEventSinkFromEnv, createSecretsFromEnv, prisma, type PumpDb } from "@frejsi/shared";

import { createPumpHandler, PUMP_SCHEDULE } from "../pump-handler";
import { createPumpSourceFactory } from "../sources";

// The Prisma client satisfies the pump cycle's database slice; a schema change that breaks the
// cycle fails to compile here.
const db: PumpDb = prisma;

// Built on the first run, not at indexing time, so a missing KEY_VAULT_URL or Web PubSub setting
// fails the invocation with a log line and not the whole app's startup.
let sources: ReturnType<typeof createPumpSourceFactory> | undefined;
let sink: ReturnType<typeof createEventSinkFromEnv> | undefined;

// The pump record's own timer (v0.7.0 plan §5): every fifteen minutes, separate from `poll`, so a
// slow pump fetch never delays a glucose cycle.
app.timer("pump-poll", {
  schedule: PUMP_SCHEDULE,
  runOnStartup: false,
  handler: (timer, context) => {
    sources ??= createPumpSourceFactory({ secrets: createSecretsFromEnv });
    sink ??= createEventSinkFromEnv();
    return createPumpHandler({ cycleDeps: { db, sources, sink } })(timer, context);
  },
});
