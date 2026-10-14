import { createSecretsFromEnv, emit, log, prisma, runPollCycle, type PollDb } from "@frejsi/shared";
import { FakeGlucoseSource } from "@frejsi/shared/glucose/fake";

import { parseCliArgs } from "./cli-args";
import { createDexcomSourceFactory } from "./sources";

/**
 * `pnpm --filter ./poller poll --once [--space <id>]`: one cycle from a laptop, against the real
 * Dexcom Share account during setup (spec §3) or against `FakeGlucoseSource` with
 * `FAKE_GLUCOSE_SOURCE=1`. Events go through the real `emit`: rows always, Web PubSub when
 * `WEB_PUBSUB_ENDPOINT` or a connection string is set.
 */
async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  const db: PollDb = prisma;
  const fake = process.env.FAKE_GLUCOSE_SOURCE === "1";
  const sources = fake
    ? () => new FakeGlucoseSource()
    : createDexcomSourceFactory({ secrets: createSecretsFromEnv() });
  log.info("poll.once", { code: fake ? "fake-source" : "dexcom-share" });

  const outcomes = await runPollCycle(
    { db, sources, emit },
    args.spaceId === undefined ? {} : { spaceId: args.spaceId },
  );
  const failed = outcomes.filter((o) => o.outcome === "failed").length;
  log.info("poll.once-done", {
    count: outcomes.reduce((sum, o) => sum + o.stored, 0),
    code: failed === 0 ? "ok" : `${failed}-failed`,
  });
  await prisma.$disconnect();
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  log.error("poll.once-failed", { code: error instanceof Error ? error.name : "unknown" }, error);
  process.exitCode = 1;
});
