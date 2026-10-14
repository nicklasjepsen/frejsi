import {
  createLogger,
  glucoseSecretName,
  serializeCredential,
  type FetchLike,
} from "@frejsi/shared";
import { MemorySecrets } from "@frejsi/shared/secrets/memory";
import { describe, expect, it } from "vitest";

import { createDexcomSourceFactory } from "./sources";

const space = {
  id: "s1",
  glucoseSource: "{}",
  sourceStatus: "connected",
  sourceFailures: 0,
  lastReadingAt: null,
};
const config = { type: "dexcom-share", region: "eu", secretRef: glucoseSecretName("s1") } as const;
const credential = { username: "publisher@example.invalid", password: "<fixture-password>" };

/** Counts calls; the adapter is tested against the fixtures in shared, not here. */
function countingFetch() {
  const urls: string[] = [];
  const fetch: FetchLike = (input) => {
    urls.push(String(input));
    return Promise.resolve(new Response('"11111111-2222-4333-8444-555555555555"', { status: 200 }));
  };
  return { fetch, urls };
}

describe("createDexcomSourceFactory", () => {
  it("reads the credential by secretRef and builds a Dexcom Share source", async () => {
    const secrets = new MemorySecrets({ [config.secretRef]: serializeCredential(credential) });
    const { fetch, urls } = countingFetch();
    const sources = createDexcomSourceFactory({ secrets, fetch });
    const source = await sources(space, config);
    await expect(source.probe()).resolves.toBe("ok");
    expect(urls).toHaveLength(2);
  });

  it("keeps one instance per space across cycles, so the session is reused", async () => {
    const secrets = new MemorySecrets({
      [config.secretRef]: serializeCredential(credential),
      "glucose-s2": serializeCredential(credential),
    });
    const sources = createDexcomSourceFactory({ secrets, fetch: countingFetch().fetch });
    const first = await sources(space, config);
    const second = await sources(space, config);
    expect(second).toBe(first);
    expect(await sources({ ...space, id: "s2" }, { ...config, secretRef: "glucose-s2" })).not.toBe(
      first,
    );
  });

  it("builds a new instance when the credential or the region changes", async () => {
    const secrets = new MemorySecrets({ [config.secretRef]: serializeCredential(credential) });
    const sources = createDexcomSourceFactory({ secrets, fetch: countingFetch().fetch });
    const first = await sources(space, config);
    await secrets.set(config.secretRef, serializeCredential({ ...credential, password: "<new>" }));
    const second = await sources(space, config);
    expect(second).not.toBe(first);
    const third = await sources(space, { ...config, region: "us" });
    expect(third).not.toBe(second);
  });

  it("throws when the secret is missing or is not a credential, without leaking the secret", async () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));
    const secrets = new MemorySecrets({ "glucose-s3": "not-a-credential-value" });
    const sources = createDexcomSourceFactory({ secrets, fetch: countingFetch().fetch, log });
    await expect(sources(space, config)).rejects.toMatchObject({ code: "secret-missing" });
    await expect(
      sources({ ...space, id: "s3" }, { ...config, secretRef: "glucose-s3" }),
    ).rejects.toMatchObject({
      code: "secret-invalid",
    });
    expect(lines.join("\n")).not.toContain("not-a-credential-value");
  });
});
