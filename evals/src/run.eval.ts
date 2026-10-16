import { it } from "vitest";
import { execute } from "./harness";
// Separate from unit tests: only this explicit eval entry point may use a configured key.
it("scores recorded fixtures and the optional bounded live set", async () => {
  await execute(process.env, (message) => {
    process.stdout.write(`${message}\n`);
  });
});
