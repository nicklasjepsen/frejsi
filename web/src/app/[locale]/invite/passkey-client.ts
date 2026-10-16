// The browser side of the passkey ceremonies (spec §2b): the invitation landing registers through
// task 5's /api/auth/register routes, welcome signs in through /api/auth/login. The server does
// every check; this module only runs the two round trips in order and names what went wrong in
// a way the screens can translate. It never reads or logs the responses beyond what it returns.
// The two schemas by their own paths: the shared index also exports Prisma and App Insights,
// which have no place in the browser bundle this module is part of.
import { ApiError, type ApiErrorCode } from "@frejsi/shared/schemas/api";
import { Role } from "@frejsi/shared/schemas/auth";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { z } from "zod";

/**
 * What a screen can do with a failed ceremony. `cancelled` is the only one worth a plain "try
 * again": the prompt was dismissed or timed out. `already-registered` means this device already
 * holds a passkey for the user the link is for (an add-device link opened on the wrong device),
 * so trying again changes nothing. `authenticator` is any other refusal by the browser or the
 * authenticator. `api` carries the server's stable code.
 */
export type CeremonyFailure =
  "unsupported" | "cancelled" | "already-registered" | "authenticator" | "api";

export class CeremonyError extends Error {
  readonly kind: CeremonyFailure;
  readonly code: ApiErrorCode | null;

  constructor(kind: CeremonyFailure, code: ApiErrorCode | null = null) {
    super(code ?? kind);
    this.name = "CeremonyError";
    this.kind = kind;
    this.code = code;
  }
}

/** The pieces of `@simplewebauthn/browser` the ceremonies use; tests pass a fake. */
export interface WebAuthnBrowser {
  supported: () => boolean;
  register: (options: {
    optionsJSON: PublicKeyCredentialCreationOptionsJSON;
  }) => Promise<RegistrationResponseJSON>;
  authenticate: (options: {
    optionsJSON: PublicKeyCredentialRequestOptionsJSON;
  }) => Promise<AuthenticationResponseJSON>;
}

export interface PasskeyClientDeps {
  fetch?: typeof fetch;
  webauthn?: WebAuthnBrowser;
}

const realBrowser: WebAuthnBrowser = {
  supported: browserSupportsWebAuthn,
  register: startRegistration,
  authenticate: startAuthentication,
};

const Started = z.object({
  challengeId: z.string().min(1),
  options: z.record(z.string(), z.unknown()),
});
const Registered = z.object({ role: Role, spaceId: z.string().min(1) });
const SignedIn = z.object({ userId: z.string().min(1) });

function resolveDeps(deps: PasskeyClientDeps): { fetch: typeof fetch; webauthn: WebAuthnBrowser } {
  return {
    fetch: deps.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    webauthn: deps.webauthn ?? realBrowser,
  };
}

/**
 * One same-origin POST with a JSON body; the browser adds the `Origin` header the routes check.
 * A non-2xx answer becomes a `CeremonyError("api", code)`; a body that is not an `ApiError`
 * (a gateway page, say) is `internal`, so the screen never shows raw server text.
 */
async function post<T>(
  fetchFn: typeof fetch,
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await fetchFn(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const parsed = ApiError.safeParse(payload);
    throw new CeremonyError("api", parsed.success ? parsed.data.error.code : "internal");
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new CeremonyError("api", "internal");
  return parsed.data;
}

/**
 * Sorts what `navigator.credentials` threw. `@simplewebauthn/browser` wraps the DOMException in a
 * `WebAuthnError` that keeps its `name` and adds a `code`; both are read, so a raw DOMException
 * (as a test or another wrapper may throw) sorts the same way.
 */
export function classifyPromptError(error: unknown): CeremonyFailure {
  const { name, code } =
    typeof error === "object" && error !== null
      ? (error as { name?: unknown; code?: unknown })
      : { name: undefined, code: undefined };
  if (name === "InvalidStateError" || code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
    return "already-registered";
  }
  if (name === "NotAllowedError" || name === "AbortError" || code === "ERROR_CEREMONY_ABORTED") {
    return "cancelled";
  }
  return "authenticator";
}

/** Runs the authenticator prompt and names its failure for the screen. */
async function prompt<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw new CeremonyError(classifyPromptError(error));
  }
}

/**
 * Registers a passkey from an invitation link and signs this device in (the server sets the
 * session cookie on the verify response). Resolves with the space the invitation was for and
 * the role the person now has there, so the screen can point this device at that space.
 */
export async function registerWithInvite(
  inviteToken: string,
  deps: PasskeyClientDeps = {},
): Promise<{ role: Role; spaceId: string }> {
  const { fetch: fetchFn, webauthn } = resolveDeps(deps);
  if (!webauthn.supported()) throw new CeremonyError("unsupported");
  const started = await post(fetchFn, "/api/auth/register/options", { inviteToken }, Started);
  const response = await prompt(() =>
    webauthn.register({
      optionsJSON: started.options as unknown as PublicKeyCredentialCreationOptionsJSON,
    }),
  );
  const verified = await post(
    fetchFn,
    "/api/auth/register/verify",
    { challengeId: started.challengeId, response },
    Registered,
  );
  return { role: verified.role, spaceId: verified.spaceId };
}

/** Signs a returning device in with a discoverable credential: no username, no list. */
export async function signInWithPasskey(deps: PasskeyClientDeps = {}): Promise<{ userId: string }> {
  const { fetch: fetchFn, webauthn } = resolveDeps(deps);
  if (!webauthn.supported()) throw new CeremonyError("unsupported");
  const started = await post(fetchFn, "/api/auth/login/options", {}, Started);
  const response = await prompt(() =>
    webauthn.authenticate({
      optionsJSON: started.options as unknown as PublicKeyCredentialRequestOptionsJSON,
    }),
  );
  return post(
    fetchFn,
    "/api/auth/login/verify",
    { challengeId: started.challengeId, response },
    SignedIn,
  );
}
