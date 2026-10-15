"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { localeHref, resolveLocale } from "@/lib/i18n/routing";

import { SPACE_COOKIE } from "./space-cookie";

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** A text field's value; a file or a missing field is an empty string. */
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * "Skift rum": remembers the chosen space for this device when the user belongs to it, then
 * returns to the locale's front page, which lands on the role's home in that space.
 */
export async function switchSpace(formData: FormData): Promise<void> {
  const locale = resolveLocale(field(formData, "locale"));
  const session = await getSession();
  if (!session) redirect(localeHref(locale, "/welcome"));

  const spaceId = field(formData, "spaceId");
  if (session.memberships.some((m) => m.spaceId === spaceId)) {
    const store = await cookies();
    store.set(SPACE_COOKIE, spaceId, {
      path: "/",
      maxAge: ONE_YEAR_SECONDS,
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    });
  }
  redirect(localeHref(locale, "/"));
}
