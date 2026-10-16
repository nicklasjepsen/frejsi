import { app } from "@azure/functions";
import { createSecretsFromEnv, emit, prisma, type PollDb } from "@frejsi/shared";

import { createPollHandler, SCHEDULE } from "../poll-handler";
import { createSourceFactory } from "../sources";

// The Prisma client satisfies the cycle's database slice; this line is where a schema change
// that breaks the cycle would fail to compile.
const db: PollDb = prisma;

// Built on the first run, not at indexing time, so a missing KEY_VAULT_URL fails the invocation
// with a log line and not the whole app's startup.
let sources: ReturnType<typeof createSourceFactory> | undefined;

app.timer("poll", {
  schedule: SCHEDULE,
  runOnStartup: false,
  handler: (timer, context) => {
    sources ??= createSourceFactory({ secrets: createSecretsFromEnv });
    return createPollHandler({ cycleDeps: { db, sources, emit } })(timer, context);
  },
});
