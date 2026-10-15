// The browser side of the People routes: one typed function per call, every response validated
// against the contract, every failure a `PeopleApiError` with the stable ApiError code the screen
// translates. Same-origin, so the browser sends the Origin header the routes check.
// Schema modules, not the @frejsi/shared barrel: this runs in the browser (see contract.ts).
import { ApiError, type ApiErrorCode } from "@frejsi/shared/schemas/api";
import type { Role } from "@frejsi/shared/schemas/auth";
import type { z } from "zod";

import {
  CreatedInviteView,
  PeopleView,
  RemovedDeviceView,
  type CreateInviteBody,
} from "./contract";

export class PeopleApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
  ) {
    super(code);
    this.name = "PeopleApiError";
  }
}

async function send(path: string, init: { method: string; body?: unknown }): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(path, {
    method: init.method,
    headers,
    credentials: "same-origin",
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (response.ok) return response;
  let code: ApiErrorCode = "internal";
  try {
    const parsed = ApiError.safeParse(await response.json());
    if (parsed.success) code = parsed.data.error.code;
  } catch {
    // Not JSON: a gateway page. The code stays internal.
  }
  throw new PeopleApiError(response.status, code);
}

/** A call whose answer is a body validated by `schema`. */
async function callJson<T>(
  path: string,
  init: { method: string; body?: unknown },
  schema: z.ZodType<T>,
): Promise<T> {
  const response = await send(path, init);
  const parsed = schema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new PeopleApiError(response.status, "internal");
  return parsed.data;
}

/** A call answered with 204. */
async function callEmpty(path: string, init: { method: string; body?: unknown }): Promise<void> {
  await send(path, init);
}

const base = (spaceId: string) => `/api/spaces/${encodeURIComponent(spaceId)}`;

export const peopleApi = {
  load: (spaceId: string) => callJson(`${base(spaceId)}/members`, { method: "GET" }, PeopleView),
  createInvite: (spaceId: string, body: CreateInviteBody) =>
    callJson(`${base(spaceId)}/invites`, { method: "POST", body }, CreatedInviteView),
  resendInvite: (spaceId: string, inviteId: string) =>
    callJson(
      `${base(spaceId)}/invites/${encodeURIComponent(inviteId)}/resend`,
      { method: "POST" },
      CreatedInviteView,
    ),
  revokeInvite: (spaceId: string, inviteId: string) =>
    callEmpty(`${base(spaceId)}/invites/${encodeURIComponent(inviteId)}`, { method: "DELETE" }),
  changeRole: (spaceId: string, userId: string, role: Role) =>
    callEmpty(`${base(spaceId)}/members/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: { role },
    }),
  removeMember: (spaceId: string, userId: string) =>
    callEmpty(`${base(spaceId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
  removeDevice: (spaceId: string, passkeyId: string) =>
    callJson(
      `${base(spaceId)}/passkeys/${encodeURIComponent(passkeyId)}`,
      { method: "DELETE" },
      RemovedDeviceView,
    ),
};
