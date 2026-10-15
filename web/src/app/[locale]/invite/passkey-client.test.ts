import { describe, expect, it, vi } from "vitest";

import {
  CeremonyError,
  registerWithInvite,
  signInWithPasskey,
  type PasskeyClientDeps,
  type WebAuthnBrowser,
} from "./passkey-client";

const creation = { challenge: "c1", rp: { id: "frejsi.example" } };
const request = { challenge: "c2", rpId: "frejsi.example" };
const attestation = { id: "cred", type: "public-key", response: {} };
const assertion = { id: "cred", type: "public-key", response: {} };

interface Call {
  url: string;
  body: unknown;
}

/** A fetch that answers each POST from the given queue, recording what it was sent. */
function fakeFetch(answers: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  const mock = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    const next = answers.shift() ?? { status: 500, body: { error: { code: "internal", message: "internal" } } };
    return Promise.resolve(
      new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return { fetchFn: mock as unknown as typeof fetch, mock, calls };
}

function browser(overrides: Partial<WebAuthnBrowser> = {}): WebAuthnBrowser {
  return {
    supported: () => true,
    register: vi.fn(() => Promise.resolve(attestation)),
    authenticate: vi.fn(() => Promise.resolve(assertion)),
    ...overrides,
  } as WebAuthnBrowser;
}

const deps = (fetchFn: typeof fetch, webauthn: WebAuthnBrowser): PasskeyClientDeps => ({
  fetch: fetchFn,
  webauthn,
});

describe("registerWithInvite (task 5's routes, in the order the browser runs them)", () => {
  it("asks for options with the token, hands them to the authenticator, verifies, and returns the space and the role", async () => {
    const { fetchFn, mock, calls } = fakeFetch([
      { status: 200, body: { challengeId: "ch1", options: creation } },
      { status: 200, body: { userId: "u1", spaceId: "s1", role: "carer" } },
    ]);
    const web = browser();
    const result = await registerWithInvite("tok", deps(fetchFn, web));
    expect(result).toEqual({ role: "carer", spaceId: "s1" });
    expect(calls).toEqual([
      { url: "/api/auth/register/options", body: { inviteToken: "tok" } },
      { url: "/api/auth/register/verify", body: { challengeId: "ch1", response: attestation } },
    ]);
    expect(web.register).toHaveBeenCalledWith({ optionsJSON: creation });
    const init = mock.mock.calls[1]?.[1];
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("stops before the prompt when the browser has no WebAuthn", async () => {
    const { fetchFn, calls } = fakeFetch([]);
    const web = browser({ supported: () => false });
    await expect(registerWithInvite("tok", deps(fetchFn, web))).rejects.toEqual(
      new CeremonyError("unsupported"),
    );
    expect(calls).toEqual([]);
    expect(web.register).not.toHaveBeenCalled();
  });

  it("surfaces the API's error code when the link is dead, before any prompt", async () => {
    const { fetchFn } = fakeFetch([{ status: 410, body: { error: { code: "invite-used", message: "invite-used" } } }]);
    const web = browser();
    const failure = registerWithInvite("tok", deps(fetchFn, web));
    await expect(failure).rejects.toMatchObject({ kind: "api", code: "invite-used" });
    expect(web.register).not.toHaveBeenCalled();
  });

  it("reports a cancelled or failed prompt as cancelled, and never calls verify", async () => {
    const { fetchFn, calls } = fakeFetch([
      { status: 200, body: { challengeId: "ch1", options: creation } },
    ]);
    const web = browser({
      register: vi.fn(() => Promise.reject(new DOMException("denied", "NotAllowedError"))),
    });
    await expect(registerWithInvite("tok", deps(fetchFn, web))).rejects.toEqual(
      new CeremonyError("cancelled"),
    );
    expect(calls).toHaveLength(1);
  });

  it("maps an unparseable error body to internal and a rejected verification to its code", async () => {
    const { fetchFn } = fakeFetch([
      { status: 200, body: { challengeId: "ch1", options: creation } },
      { status: 403, body: { error: { code: "forbidden", message: "forbidden" } } },
    ]);
    await expect(
      registerWithInvite("tok", deps(fetchFn, browser())),
    ).rejects.toMatchObject({ kind: "api", code: "forbidden" });

    const broken = fakeFetch([{ status: 502, body: "<html>bad gateway</html>" }]);
    await expect(
      registerWithInvite("tok", deps(broken.fetchFn, browser())),
    ).rejects.toMatchObject({ kind: "api", code: "internal" });
  });
});

describe("signInWithPasskey (discoverable credential, no username)", () => {
  it("asks for login options with an empty body, authenticates, verifies", async () => {
    const { fetchFn, calls } = fakeFetch([
      { status: 200, body: { challengeId: "ch2", options: request } },
      { status: 200, body: { userId: "u1" } },
    ]);
    const web = browser();
    await expect(signInWithPasskey(deps(fetchFn, web))).resolves.toEqual({
      userId: "u1",
    });
    expect(calls).toEqual([
      { url: "/api/auth/login/options", body: {} },
      { url: "/api/auth/login/verify", body: { challengeId: "ch2", response: assertion } },
    ]);
    expect(web.authenticate).toHaveBeenCalledWith({ optionsJSON: request });
  });

  it("reports an unknown passkey as the API's code", async () => {
    const { fetchFn } = fakeFetch([
      { status: 200, body: { challengeId: "ch2", options: request } },
      { status: 403, body: { error: { code: "forbidden", message: "forbidden" } } },
    ]);
    await expect(signInWithPasskey(deps(fetchFn, browser()))).rejects.toMatchObject(
      { kind: "api", code: "forbidden" },
    );
  });
});
