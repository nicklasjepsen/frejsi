// The web side of the Settings route → `source-connect` contract (plan §4, §7). The Function App
// probes the credential and writes it to Key Vault with its own identity; the web app only
// forwards the request and reads the result. The credential is in the request body and nowhere
// else: not stored, not logged, not in the error.
import { ConnectSourceResult, type ConnectSourceRequest } from "@frejsi/shared";

/**
 * The environment, read for the two app settings `infra/deploy.sh` writes for the web app:
 * `SOURCE_CONNECT_URL` and `SOURCE_CONNECT_KEY` (plan §7).
 */
export type ConnectSourceEnv = Record<string, string | undefined>;

/** Azure Functions reads the function key from this header. */
const FUNCTION_KEY_HEADER = "x-functions-key";

/**
 * How long the web waits for `source-connect`, which itself calls Dexcom. Past this the owner gets
 * the designed "source-unreachable" answer instead of a request the platform kills.
 */
export const SOURCE_CONNECT_TIMEOUT_MS = 20_000;

/**
 * Why the function could not be used, for the route's log line only. `http-<status>` names a
 * non-2xx answer; none of these carries request data.
 */
export type UnreachableCause =
  "not-configured" | "timeout" | "network" | `http-${number}` | "bad-body" | "source-unreachable";

/** A `ConnectSourceResult`, with the cause attached when it is `unreachable`. */
export type ConnectSourceOutcome =
  | Exclude<ConnectSourceResult, { result: "unreachable" }>
  | { result: "unreachable"; cause: UnreachableCause };

const unreachable = (cause: UnreachableCause): ConnectSourceOutcome => ({
  result: "unreachable",
  cause,
});

const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

/**
 * Posts the request to the `source-connect` function and returns its result. Everything that is
 * not a clean `ConnectSourceResult` (no URL configured, no answer within the timeout, a network
 * error, a non-2xx answer, a body in another shape) is `unreachable` with its cause: the owner can
 * try again, and nothing was saved.
 */
export async function connectSource(
  request: ConnectSourceRequest,
  env: ConnectSourceEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = SOURCE_CONNECT_TIMEOUT_MS,
): Promise<ConnectSourceOutcome> {
  const url = env.SOURCE_CONNECT_URL;
  if (!url) return unreachable("not-configured");

  const headers = new Headers({ "content-type": "application/json" });
  if (env.SOURCE_CONNECT_KEY) headers.set(FUNCTION_KEY_HEADER, env.SOURCE_CONNECT_KEY);

  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    return unreachable(isAbort(error) ? "timeout" : "network");
  }
  if (!response.ok) return unreachable(`http-${response.status}`);

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return unreachable(isAbort(error) ? "timeout" : "bad-body");
  }
  const parsed = ConnectSourceResult.safeParse(body);
  if (!parsed.success) return unreachable("bad-body");
  // The function answered cleanly that it could not reach the source itself.
  if (parsed.data.result === "unreachable") return unreachable("source-unreachable");
  return parsed.data;
}
