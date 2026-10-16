import { describe, expect, it } from "vitest";

import { parseNightscoutCredential, serializeNightscoutCredential } from "./credential";

describe("the Nightscout credential secret", () => {
  const credential = { url: "https://example-ns.example.invalid", token: "fixture-token" };

  it("round-trips through the string stored in Key Vault", () => {
    expect(parseNightscoutCredential(serializeNightscoutCredential(credential))).toEqual(
      credential,
    );
  });

  it("refuses to parse anything that is not a credential, so a wrong secret fails loudly", () => {
    expect(() => parseNightscoutCredential("not json")).toThrow();
    expect(() =>
      parseNightscoutCredential(JSON.stringify({ username: "a", password: "b" })),
    ).toThrow();
    expect(() =>
      parseNightscoutCredential(
        JSON.stringify({ url: "http://example-ns.example.invalid", token: "t" }),
      ),
    ).toThrow();
  });

  it("refuses to serialise a credential with both secrets or neither", () => {
    expect(() => serializeNightscoutCredential({ url: credential.url })).toThrow();
    expect(() => serializeNightscoutCredential({ ...credential, apiSecret: "s" })).toThrow();
  });
});
