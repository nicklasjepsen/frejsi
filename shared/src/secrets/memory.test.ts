import { describe, expect, it } from "vitest";

import { MemorySecrets } from "./memory";
import type { Secrets } from "./types";

describe("MemorySecrets", () => {
  it("satisfies Secrets: set, get, and undefined for a missing name", async () => {
    const secrets: Secrets = new MemorySecrets({ "glucose-s1": "seeded" });
    await expect(secrets.get("glucose-s1")).resolves.toBe("seeded");
    await secrets.set("glucose-s2", "value");
    await expect(secrets.get("glucose-s2")).resolves.toBe("value");
    await expect(secrets.get("nope")).resolves.toBeUndefined();
  });
});
