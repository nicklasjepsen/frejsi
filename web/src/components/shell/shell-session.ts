import { cookies } from "next/headers";
import { cache } from "react";
import type { SessionContext } from "@frejsi/shared";

import { getSession } from "@/lib/auth/session";

import { loadShellData, type ShellData } from "./load-shell";
import { SPACE_COOKIE } from "./space-cookie";

/**
 * The request's session, loaded once. Next renders a layout and its page concurrently, and
 * `getSession()` touches `lastSeenAt` and emits `member.updated` once an hour; two bare calls in
 * one request would both pass the hourly check and write and emit twice. React `cache` keeps one
 * result per request, so the `(app)` layout and every page under it share one load.
 */
export const getShellSession = cache((): Promise<SessionContext | null> => getSession());

/** The shell data for the request's session and the device's chosen space, once per request. */
export const getShell = cache(async (): Promise<ShellData | null> => {
  const session = await getShellSession();
  if (!session) return null;
  return loadShellData(session, (await cookies()).get(SPACE_COOKIE)?.value);
});
