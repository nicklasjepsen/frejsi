import { describe, expect, it } from "vitest";

import { MemorySecrets } from "./memory";
import type { Secrets } from "./types";

describe("MemorySecrets", () => {
  it("satisfies Secrets: set answers a versioned reference, get reads it or the latest by name", async () => {
    const secrets: Secrets = new MemorySecrets({ "glucose-s1": "seeded" });
    await expect(secrets.get("glucose-s1")).resolves.toBe("seeded");
    const ref = await secrets.set("glucose-s2", "value");
    expect(ref).toBe("glucose-s2/2");
    await expect(secrets.get(ref)).resolves.toBe("value");
    await expect(secrets.get("glucose-s2")).resolves.toBe("value");
    await expect(secrets.get("nope")).resolves.toBeUndefined();
    await expect(secrets.get("glucose-s2/9")).resolves.toBeUndefined();
  });

  it("keeps every version: an older reference still reads what it named (#78)", async () => {
    const secrets = new MemorySecrets();
    const first = await secrets.set("glucose-s1", "first");
    const second = await secrets.set("glucose-s1", "second");
    expect(first).not.toBe(second);
    await expect(secrets.get(first)).resolves.toBe("first");
    await expect(secrets.get(second)).resolves.toBe("second");
    await expect(secrets.get("glucose-s1")).resolves.toBe("second");
  });

  it("refuses a malformed reference without echoing it", async () => {
    const secrets = new MemorySecrets();
    await expect(secrets.get("../x")).rejects.toThrow(/^secret name is invalid$/);
    await expect(secrets.set("a/b", "v")).rejects.toThrow(/^secret name is invalid$/);
  });
});
