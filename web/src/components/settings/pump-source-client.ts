// The browser side of the pump-source route (v0.7.0 plan task 3): read the card's state, connect
// and disconnect. An ApiError body becomes an `ApiFailure` with its stable code, which the card
// translates, exactly as the other Settings calls do.
// Values come from the pure modules by path, never from the shared index: a client bundle must not
// pull in the Prisma client or App Insights that the index exports (plan §2; see routing.ts).
import { ApiError } from "@frejsi/shared/schemas/api";
import { PumpSettingsView, type ConnectPumpBody } from "@frejsi/shared/schemas/pump";
import { z } from "zod";

import { ApiFailure } from "./settings-client";

/**
 * What the form posts. The address is only a bounded string here: the route checks it against the
 * shared `ConnectPumpRequest` and answers `source-url-invalid`, so a bad address is told apart from
 * a malformed body. The route adds `purpose` and the `spaceId`, so a body with either is refused.
 */
export const PumpSourceBody = z.strictObject({
  type: z.literal("nightscout"),
  url: z.string().max(2048),
  token: z.string().min(1).max(200).optional(),
  apiSecret: z.string().min(1).max(200).optional(),
});
export type PumpSourceBody = z.infer<typeof PumpSourceBody>;

/** The view after a connect, with how many boluses the last day held when the function could tell. */
export const ConnectedPumpSettings = PumpSettingsView.safeExtend({
  recentBoluses: z.number().int().nonnegative().optional(),
});
export type ConnectedPumpSettings = z.infer<typeof ConnectedPumpSettings>;

async function call<T>(
  url: string,
  method: "GET" | "POST" | "DELETE",
  body: unknown,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiFailure("internal", 0);
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ApiError.safeParse(json);
    throw new ApiFailure(parsed.success ? parsed.data.error.code : "internal", response.status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiFailure("internal", response.status);
  return parsed.data;
}

const pumpPath = (spaceId: string) => `/api/spaces/${encodeURIComponent(spaceId)}/pump-source`;

/** The calls the pump card makes; `fetchImpl` is for tests. */
export function pumpSourceApi(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  return {
    get: (spaceId: string) =>
      call(pumpPath(spaceId), "GET", undefined, PumpSettingsView, fetchImpl),
    connect: (spaceId: string, body: ConnectPumpBody | PumpSourceBody) =>
      call(pumpPath(spaceId), "POST", body, ConnectedPumpSettings, fetchImpl),
    disconnect: (spaceId: string) =>
      call(pumpPath(spaceId), "DELETE", undefined, PumpSettingsView, fetchImpl),
  };
}

export type PumpSourceApi = ReturnType<typeof pumpSourceApi>;
