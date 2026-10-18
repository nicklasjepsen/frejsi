// The client side of `GET /api/spaces/:id/pump` (v0.7.0 plan §4). Browser-safe: the schema module
// only, never the shared barrel.
import { PumpHistoryView } from "@frejsi/shared/schemas/pump";

export class PumpRequestError extends Error {
  constructor(readonly status: number) {
    super(`pump-${String(status)}`);
  }
}

/** The pump record between `from` and `to` (ISO instants, at most eight days apart). */
export async function loadPumpHistory(
  spaceId: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<PumpHistoryView> {
  const query = new URLSearchParams({ from, to });
  const response = await fetch(
    `/api/spaces/${encodeURIComponent(spaceId)}/pump?${query.toString()}`,
    {
      headers: { accept: "application/json" },
      credentials: "same-origin",
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) throw new PumpRequestError(response.status);
  return PumpHistoryView.parse(await response.json());
}
