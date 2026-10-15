// No PII in logs (CLAUDE.md, plan §9): after every flow has run, nothing the server wrote names a
// seeded person or the space.
import fs from "node:fs";

import { expect, test } from "./test";

import { SEED_NAMES } from "../scripts/seed";
import { SERVER_LOG } from "./env";

test("the server log of the run contains no seeded name", () => {
  const log = fs.readFileSync(SERVER_LOG, "utf8");
  expect(log.length).toBeGreaterThan(0);
  for (const name of SEED_NAMES) {
    expect(log, name).not.toContain(name);
  }
});
