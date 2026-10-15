import {
  createLogger,
  DexcomShareSource,
  glucoseSecretName,
  parseCredential,
  type ProbeResult,
} from "@frejsi/shared";
import { MemorySecrets } from "@frejsi/shared/secrets/memory";
import { describe, expect, it } from "vitest";

import { createSourceConnectHandler, probeSourceFor } from "./source-connect-handler";

const body = {
  spaceId: "s1",
  type: "dexcom-share",
  region: "eu",
  username: "publisher@example.invalid",
  password: "<fixture-password>",
};

function harness(probeResult: ProbeResult | Error) {
  const secrets = new MemorySecrets();
  const lines: string[] = [];
  const probes: unknown[] = [];
  const handler = createSourceConnectHandler({
    secrets,
    log: createLogger((line) => lines.push(line)),
    probe: (request) => {
      probes.push(request);
      return probeResult instanceof Error
        ? Promise.reject(probeResult)
        : Promise.resolve(probeResult);
    },
  });
  const call = (json: unknown) =>
    handler({ json: () => Promise.resolve(json) } as never, {} as never);
  return { secrets, lines, probes, call };
}

describe("probeSourceFor", () => {
  it("builds the adapter the request's type names", () => {
    const source = probeSourceFor({
      type: "dexcom-share",
      region: "eu",
      username: body.username,
      password: body.password,
    });
    expect(source).toBeInstanceOf(DexcomShareSource);
  });
});

describe("source-connect", () => {
  it("probes the credential and stores it in Key Vault as glucose-<spaceId> when it works", async () => {
    const h = harness("ok");
    const response = await h.call(body);
    expect(response).toEqual({
      status: 200,
      jsonBody: { result: "ok", secretRef: glucoseSecretName("s1") },
    });
    // The source type travels with the credential: the probe dispatches on it, not on a default.
    expect(h.probes).toEqual([
      { type: "dexcom-share", region: "eu", username: body.username, password: body.password },
    ]);
    expect(parseCredential((await h.secrets.get("glucose-s1")) ?? "")).toEqual({
      username: body.username,
      password: body.password,
    });
  });

  it("stores nothing and answers bad-credentials when the probe says so", async () => {
    const h = harness("bad-credentials");
    expect(await h.call(body)).toEqual({ status: 200, jsonBody: { result: "bad-credentials" } });
    await expect(h.secrets.get("glucose-s1")).resolves.toBeUndefined();
  });

  it("answers unreachable when the probe says so or throws", async () => {
    expect(await harness("unreachable").call(body)).toEqual({
      status: 200,
      jsonBody: { result: "unreachable" },
    });
    const thrown = harness(new Error("ECONNRESET to publisher@example.invalid"));
    expect(await thrown.call(body)).toEqual({ status: 200, jsonBody: { result: "unreachable" } });
    await expect(thrown.secrets.get("glucose-s1")).resolves.toBeUndefined();
  });

  it("rejects a body that is not a ConnectSourceRequest with 400 validation", async () => {
    const h = harness("ok");
    const { password: _password, ...withoutPassword } = body;
    expect(await h.call(withoutPassword)).toMatchObject({
      status: 400,
      jsonBody: { error: { code: "validation" } },
    });
    expect(await h.call("not json")).toMatchObject({ status: 400 });
    expect(h.probes).toEqual([]);
  });

  it("rejects a request whose body cannot be parsed as JSON with 400", async () => {
    const h = harness("ok");
    const response = await createSourceConnectHandler({
      secrets: h.secrets,
      log: createLogger(() => undefined),
      probe: () => Promise.resolve("ok"),
    })({ json: () => Promise.reject(new SyntaxError("Unexpected token")) } as never, {} as never);
    expect(response).toMatchObject({ status: 400, jsonBody: { error: { code: "validation" } } });
  });

  it("never writes the username or the password to the log", async () => {
    for (const outcome of ["ok", "bad-credentials", "unreachable", new Error("down")] as const) {
      const h = harness(outcome);
      await h.call(body);
      expect(h.lines.length).toBeGreaterThan(0);
      const output = h.lines.join("\n");
      expect(output).not.toContain(body.password);
      expect(output).not.toContain(body.username);
      expect(output).toContain('"spaceId":"s1"');
    }
  });
});
