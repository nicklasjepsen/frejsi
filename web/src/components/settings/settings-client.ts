// The browser side of the Settings routes: one fetch wrapper that turns an ApiError body into an
// `ApiFailure` with its stable code, which the screens translate (plan §9).
// Values come from the pure modules by path, never from the shared index: a client bundle must not
// pull in the Prisma client or App Insights that the index exports (plan §2; see routing.ts).
import type { ApiErrorCode } from "@frejsi/shared";
import { ApiError } from "@frejsi/shared/schemas/api";
import { GlucoseImportResult, type GlucoseImportRequest } from "@frejsi/shared/schemas/glucose";
import { SpaceSettings, UserSettings } from "@frejsi/shared/schemas/settings";
import type { z } from "zod";

import type { ConnectSourceBody, SpaceSettingsPatch, UserSettingsPatch } from "./contracts";

export class ApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
  ) {
    super(code);
    this.name = "ApiFailure";
  }
}

async function call<T>(
  url: string,
  method: "PATCH" | "POST",
  body: unknown,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
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

const id = encodeURIComponent;

/** The calls the Settings screens make; `fetchImpl` is for tests. */
export function settingsApi(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
  const patchMe = (patch: UserSettingsPatch) =>
    call("/api/users/me", "PATCH", patch, UserSettings, fetchImpl);
  const patchMember = (spaceId: string, userId: string, patch: UserSettingsPatch) =>
    call(
      `/api/spaces/${id(spaceId)}/settings/members/${id(userId)}`,
      "PATCH",
      patch,
      UserSettings,
      fetchImpl,
    );
  return {
    patchSpace: (spaceId: string, patch: SpaceSettingsPatch) =>
      call(`/api/spaces/${id(spaceId)}/settings`, "PATCH", patch, SpaceSettings, fetchImpl),
    patchMe,
    patchMember,
    /** One's own settings through `/users/me`; another member's through the owner route. */
    patchPerson: (spaceId: string, userId: string, isMe: boolean, patch: UserSettingsPatch) =>
      isMe ? patchMe(patch) : patchMember(spaceId, userId, patch),
    connectSource: (spaceId: string, body: ConnectSourceBody) =>
      call(`/api/spaces/${id(spaceId)}/source`, "POST", body, SpaceSettings, fetchImpl),
    /** The export file as text; the answer is counts (#154). */
    importGlucose: (spaceId: string, body: GlucoseImportRequest) =>
      call(`/api/spaces/${id(spaceId)}/import`, "POST", body, GlucoseImportResult, fetchImpl),
  };
}

export type SettingsApi = ReturnType<typeof settingsApi>;

/** The code to translate for a failed call; anything that is not an `ApiFailure` is `internal`. */
export function failureCode(error: unknown): ApiErrorCode {
  return error instanceof ApiFailure ? error.code : "internal";
}
