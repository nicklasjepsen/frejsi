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
 * Posts the request to the `source-connect` function and returns its result. Everything that is
 * not a clean `ConnectSourceResult` (no URL configured, a network error, a non-2xx answer, a body
 * in another shape) is `unreachable`: the owner can try again, and nothing was saved.
 */
export async function connectSource(
  request: ConnectSourceRequest,
  env: ConnectSourceEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectSourceResult> {
  const url = env.SOURCE_CONNECT_URL;
  if (!url) return { result: "unreachable" };

  const headers = new Headers({ "content-type": "application/json" });
  if (env.SOURCE_CONNECT_KEY) headers.set(FUNCTION_KEY_HEADER, env.SOURCE_CONNECT_KEY);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });
    if (!response.ok) return { result: "unreachable" };
    const parsed = ConnectSourceResult.safeParse(await response.json());
    return parsed.success ? parsed.data : { result: "unreachable" };
  } catch {
    return { result: "unreachable" };
  }
}
