import { describe, expect, it } from "vitest";

import { parseCredential, serializeCredential } from "./credential";

describe("Dexcom Share credential", () => {
  it("round-trips through the secret value", () => {
    const value = serializeCredential({ username: "publisher@example.invalid", password: "<pw>" });
    expect(parseCredential(value)).toEqual({
      username: "publisher@example.invalid",
      password: "<pw>",
    });
  });

  it("rejects a secret that is not a credential", () => {
    expect(() => parseCredential('"just-a-string"')).toThrow();
    expect(() => parseCredential('{"username":""}')).toThrow();
    expect(() => parseCredential("not json")).toThrow();
  });
});
