// The web side of the pump-source route → `source-connect` contract (v0.7.0 plan §4, §5, decision
// 2): the same function and app settings as the glucose connect, with `purpose: "pump"` in a strict
// body, so the function probes the Nightscout pump record and writes `pump-<spaceId>`. The address
// and the token are in the request body and nowhere else: not stored, not logged, not in an error.
import { ConnectPumpResult, type ConnectPumpRequest } from "@frejsi/shared";

import {
  SOURCE_CONNECT_TIMEOUT_MS,
  type ConnectSourceEnv,
  type UnreachableCause,
} from "@/components/settings/source-connect-client";

/** Azure Functions reads the function key from this header. */
const FUNCTION_KEY_HEADER = "x-functions-key";

/** A `ConnectPumpResult`, with the cause attached when it is `unreachable`. */
export type ConnectPumpOutcome =
  | Exclude<ConnectPumpResult, { result: "unreachable" }>
  | { result: "unreachable"; cause: UnreachableCause };

const unreachable = (cause: UnreachableCause): ConnectPumpOutcome => ({
  result: "unreachable",
  cause,
});

const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");

/**
 * Posts the request to `source-connect` and returns its result. Anything that is not a clean
 * `ConnectPumpResult` (no URL, no answer in time, a network error, a non-2xx answer, a body in
 * another shape, a glucose answer included) is `unreachable` with its cause, and nothing is saved.
 */
export async function connectPump(
  request: ConnectPumpRequest,
  env: ConnectSourceEnv = process.env,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = SOURCE_CONNECT_TIMEOUT_MS,
): Promise<ConnectPumpOutcome> {
  const url = env.SOURCE_CONNECT_URL;
  if (!url) return unreachable("not-configured");

  const headers = new Headers({ "content-type": "application/json" });
  if (env.SOURCE_CONNECT_KEY) headers.set(FUNCTION_KEY_HEADER, env.SOURCE_CONNECT_KEY);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
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
  const parsed = ConnectPumpResult.safeParse(body);
  if (!parsed.success) return unreachable("bad-body");
  if (parsed.data.result === "unreachable") return unreachable("source-unreachable");
  return parsed.data;
}
