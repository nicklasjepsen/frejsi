// The browser side of `POST /api/spaces/:id/readings`. Schema modules, not the @frejsi/shared
// barrel: this is bundled for the browser.
import { ApiError, type ApiErrorCode } from "@frejsi/shared/schemas/api";
import { Reading, type GlucoseUnit } from "@frejsi/shared/schemas/index";

export class ManualReadingError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
  ) {
    super(code);
    this.name = "ManualReadingError";
  }
}

/** Stores one finger-prick value; `ts` is left out for "now" so the server's clock decides. */
export async function postManualReading(
  spaceId: string,
  body: { value: number; unit: GlucoseUnit; ts?: string },
): Promise<Reading> {
  let response: Response;
  try {
    response = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/readings`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
  } catch {
    throw new ManualReadingError(0, "internal");
  }
  if (response.ok) {
    const parsed = Reading.safeParse(await response.json().catch(() => null));
    if (parsed.success) return parsed.data;
    throw new ManualReadingError(response.status, "internal");
  }
  const failure = ApiError.safeParse(await response.json().catch(() => null));
  throw new ManualReadingError(
    response.status,
    failure.success ? failure.data.error.code : "internal",
  );
}
