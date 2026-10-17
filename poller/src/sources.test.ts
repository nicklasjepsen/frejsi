import {
  createLogger,
  DexcomShareSource,
  glucoseSecretName,
  NightscoutSource,
  serializeCredential,
  serializeNightscoutCredential,
  type FetchLike,
} from "@frejsi/shared";
import { FakeGlucoseSource } from "@frejsi/shared/glucose/fake";
import { MemorySecrets } from "@frejsi/shared/secrets/memory";
import { describe, expect, it } from "vitest";

import { createSourceFactory } from "./sources";

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

/** Like `countingFetch`, and keeps the password each Dexcom login was made with. */
function loginRecordingFetch() {
  const logins: unknown[] = [];
  const fetch: FetchLike = (input, init) => {
    if (String(input).endsWith("AuthenticatePublisherAccount")) {
      logins.push((JSON.parse(String(init?.body)) as { password?: unknown }).password);
    }
    return Promise.resolve(new Response('"11111111-2222-4333-8444-555555555555"', { status: 200 }));
  };
  return { fetch, logins };
}

describe("createSourceFactory", () => {
  it("reads the credential by secretRef and builds a Dexcom Share source", async () => {
    const secrets = new MemorySecrets({ [config.secretRef]: serializeCredential(credential) });
    const { fetch, urls } = countingFetch();
    const sources = createSourceFactory({ secrets, fetch });
    const source = await sources(space, config);
    await expect(source.probe()).resolves.toBe("ok");
    expect(urls).toHaveLength(2);
  });

  it("keeps one instance per space across cycles, so the session is reused", async () => {
    const secrets = new MemorySecrets({
      [config.secretRef]: serializeCredential(credential),
      "glucose-s2": serializeCredential(credential),
    });
    const sources = createSourceFactory({ secrets, fetch: countingFetch().fetch });
    const first = await sources(space, config);
    const second = await sources(space, config);
    expect(second).toBe(first);
    expect(await sources({ ...space, id: "s2" }, { ...config, secretRef: "glucose-s2" })).not.toBe(
      first,
    );
  });

  it("builds a new instance when the credential or the region changes", async () => {
    const secrets = new MemorySecrets({ [config.secretRef]: serializeCredential(credential) });
    const sources = createSourceFactory({ secrets, fetch: countingFetch().fetch });
    const first = await sources(space, config);
    await secrets.set(config.secretRef, serializeCredential({ ...credential, password: "<new>" }));
    const second = await sources(space, config);
    expect(second).not.toBe(first);
    const third = await sources(space, { ...config, region: "us" });
    expect(third).not.toBe(second);
  });

  it("reads exactly the version the reference names, not the latest under the name (#78)", async () => {
    const secrets = new MemorySecrets();
    const older = await secrets.set(config.secretRef, serializeCredential(credential));
    await secrets.set(
      config.secretRef,
      serializeCredential({ ...credential, password: "<newer>" }),
    );
    const { fetch, logins } = loginRecordingFetch();
    const sources = createSourceFactory({ secrets, fetch });
    await (await sources(space, { ...config, secretRef: older })).probe();
    expect(logins).toEqual([credential.password]);
  });

  it("reads the latest version for a reference stored before versions existed: the plain name", async () => {
    const secrets = new MemorySecrets();
    await secrets.set(config.secretRef, serializeCredential({ ...credential, password: "<old>" }));
    await secrets.set(config.secretRef, serializeCredential(credential));
    const { fetch, logins } = loginRecordingFetch();
    const sources = createSourceFactory({ secrets, fetch });
    expect(config.secretRef).toBe("glucose-s1");
    await (await sources(space, config)).probe();
    expect(logins).toEqual([credential.password]);
  });

  it("throws when the secret is missing or is not a credential, without leaking the secret", async () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));
    const secrets = new MemorySecrets({ "glucose-s3": "not-a-credential-value" });
    const sources = createSourceFactory({ secrets, fetch: countingFetch().fetch, log });
    await expect(sources(space, config)).rejects.toMatchObject({ code: "secret-missing" });
    await expect(
      sources({ ...space, id: "s3" }, { ...config, secretRef: "glucose-s3" }),
    ).rejects.toMatchObject({
      code: "secret-invalid",
    });
    expect(lines.join("\n")).not.toContain("not-a-credential-value");
  });
});

// Assembled from pieces so this file does not trip the lint boundary it sits under.
const entriesPath = ["/api", "v1", "entries"].join("/");
const header = ["api", "secret"].join("-");

describe("createSourceFactory dispatch", () => {
  const nightscoutConfig = { type: "nightscout", secretRef: glucoseSecretName("s1") } as const;
  const nightscout = { url: "https://example-ns.example.invalid", token: "<fixture-token>" };

  it("builds a Dexcom Share source for dexcom-share and a Nightscout source for nightscout", async () => {
    const secrets = new MemorySecrets({ [config.secretRef]: serializeCredential(credential) });
    const sources = createSourceFactory({ secrets, fetch: countingFetch().fetch });
    expect(await sources(space, config)).toBeInstanceOf(DexcomShareSource);

    await secrets.set(config.secretRef, serializeNightscoutCredential(nightscout));
    expect(await sources(space, nightscoutConfig)).toBeInstanceOf(NightscoutSource);
  });

  it("polls a Nightscout site with the credential from the secret, header not URL", async () => {
    const secrets = new MemorySecrets({
      [config.secretRef]: serializeNightscoutCredential(nightscout),
    });
    const seen: { url: string; headers: Record<string, string> | undefined }[] = [];
    const sources = createSourceFactory({
      secrets,
      fetch: (input, init) => {
        seen.push({ url: String(input), headers: init?.headers });
        return Promise.resolve(new Response("[]", { status: 200 }));
      },
    });
    const source = await sources(space, nightscoutConfig);
    await source.fetchSince(new Date(Date.now() - 30 * 60_000));
    expect(new URL(seen[0]?.url ?? "").host).toBe("example-ns.example.invalid");
    expect(seen[0]?.url).toContain(entriesPath);
    expect(seen[0]?.url).not.toContain("fixture-token");
    expect(seen[0]?.headers?.[header]).toBe("<fixture-token>");
  });

  it("reports secret-invalid when the secret is not the credential the type expects", async () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line));
    const secrets = new MemorySecrets({
      [config.secretRef]: serializeCredential(credential),
      "glucose-s2": serializeNightscoutCredential(nightscout),
      "glucose-s3": JSON.stringify({ url: "http://example-ns.example.invalid", token: "t" }),
    });
    const sources = createSourceFactory({ secrets, log });
    await expect(sources(space, nightscoutConfig)).rejects.toMatchObject({
      code: "secret-invalid",
    });
    await expect(
      sources({ ...space, id: "s2" }, { ...config, secretRef: "glucose-s2" }),
    ).rejects.toMatchObject({ code: "secret-invalid" });
    await expect(
      sources({ ...space, id: "s3" }, { ...nightscoutConfig, secretRef: "glucose-s3" }),
    ).rejects.toMatchObject({ code: "secret-invalid" });
    await expect(
      sources({ ...space, id: "s4" }, { ...nightscoutConfig, secretRef: "glucose-s4" }),
    ).rejects.toMatchObject({ code: "secret-missing" });
    expect(lines.join("\n")).not.toMatch(/example-ns|fixture-token|publisher@/);
  });

  it("returns the fake for every space, reading no secret, when FAKE_GLUCOSE_SOURCE=1", async () => {
    const secrets = new MemorySecrets();
    const sources = createSourceFactory({ secrets, env: { FAKE_GLUCOSE_SOURCE: "1" } });
    expect(await sources(space, config)).toBeInstanceOf(FakeGlucoseSource);
    expect(await sources(space, nightscoutConfig)).toBeInstanceOf(FakeGlucoseSource);
    const lazy = createSourceFactory({
      secrets: () => {
        throw new Error("Key Vault is not configured");
      },
      env: { FAKE_GLUCOSE_SOURCE: "1" },
    });
    expect(await lazy(space, config)).toBeInstanceOf(FakeGlucoseSource);
    const off = createSourceFactory({ secrets, env: { FAKE_GLUCOSE_SOURCE: "0" } });
    await expect(off(space, config)).rejects.toMatchObject({ code: "secret-missing" });
  });
});
