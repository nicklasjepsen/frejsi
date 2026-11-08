import { app } from "@azure/functions";
import { createSecretsFromEnv, log, prisma } from "@naensom/shared";

import { createApnsSenders, createEntryReader, runLivePoll, type RelayDeps } from "../live/relay";
import { PrismaLiveStore } from "../live/store";

/** Every minute at second 0 (plan 2026-11-08-ios-follower-app §4); each run checks what is due. */
export const LIVE_POLL_SCHEDULE = "0 * * * * *";

// Built on the first run, not at indexing time, so a missing KEY_VAULT_URL fails the invocation
// with a log line and not the whole app's startup. The APNs senders and the credential cache live
// for the process.
let deps: RelayDeps | undefined;

app.timer("live-poll", {
  schedule: LIVE_POLL_SCHEDULE,
  runOnStartup: false,
  handler: async () => {
    if (deps === undefined) {
      const secrets = createSecretsFromEnv();
      deps = {
        store: new PrismaLiveStore(prisma),
        secrets,
        readEntries: createEntryReader({ secrets }),
        send: createApnsSenders(secrets),
        now: Date.now,
        log,
      };
    }
    await runLivePoll(deps);
  },
});
