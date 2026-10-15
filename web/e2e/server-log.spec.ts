// No PII in logs (CLAUDE.md, plan §9): after every flow has run, nothing the server wrote names a
// seeded person or the space.
import fs from "node:fs";

import { prisma } from "@frejsi/shared";
import { expect, test } from "./test";

import { SEED_NAMES } from "../scripts/seed";
import { SERVER_LOG } from "./env";

test("the server log of the run contains no seeded name, title or reading value", async () => {
  const log = fs.readFileSync(SERVER_LOG, "utf8");
  expect(log.length).toBeGreaterThan(0);
  for (const name of SEED_NAMES) {
    expect(log, name).not.toContain(name);
  }
  expect(log).not.toContain("mindre æble");
  const readings = await prisma.reading.findMany({ select: { mmol: true } });
  // Match serialized values, not bare digits that also occur in timestamps, ports and counts.
  for (const value of new Set(readings.map((row) => row.mmol.toNumber()))) {
    expect(log).not.toMatch(
      new RegExp(`"(?:mmol|mgdl)"\\s*:\\s*${String(value).replace(".", "\\.")}(?:[,}\\s])`),
    );
  }
});
