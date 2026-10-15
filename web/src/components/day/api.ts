// The browser side of `GET day` (plan §7, task 8): the one meal read every member may make. The
// answer is parsed with the strict `DayView`, so nothing the contract does not name reaches a
// screen. Schema modules, not the @frejsi/shared barrel: this is bundled for the browser.
import { ApiError, type ApiErrorCode } from "@frejsi/shared/schemas/api";
import { DayView } from "@frejsi/shared/schemas/meal";

export class DayApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
  ) {
    super(code);
    this.name = "DayApiError";
  }
}

/** Today in the space's zone; `date` (YYYY-MM-DD) for another day. */
export async function fetchDay(
  spaceId: string,
  options: { date?: string; signal?: AbortSignal } = {},
): Promise<DayView> {
  const query = options.date ? `?${new URLSearchParams({ date: options.date }).toString()}` : "";
  let response: Response;
  try {
    response = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/day${query}`, {
      headers: { accept: "application/json" },
      credentials: "same-origin",
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new DayApiError(0, "internal");
  }
  if (!response.ok) {
    let code: ApiErrorCode = "internal";
    try {
      const parsed = ApiError.safeParse(await response.json());
      if (parsed.success) code = parsed.data.error.code;
    } catch {
      // Not JSON: a gateway page. The code stays internal.
    }
    throw new DayApiError(response.status, code);
  }
  const parsed = DayView.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new DayApiError(response.status, "internal");
  return parsed.data;
}
