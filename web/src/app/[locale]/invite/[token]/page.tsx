import { HttpError } from "@frejsi/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { inviteView } from "@/app/api/invites/invite-view";
import { getMessages } from "@/lib/i18n/messages";
import { resolveLocale } from "@/lib/i18n/routing";

import { InviteLanding } from "../InviteLanding";
import { InviteUnavailable } from "../InviteUnavailable";
import { isDeadInviteCode } from "../dead-link";

type Params = Promise<{ locale: string; token: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = resolveLocale((await params).locale);
  return { title: getMessages(locale).invite.pageTitle };
}

/**
 * The invitation landing (spec §2b, plan task 6). Public: the token is the key, and the page
 * reads it through the same `inviteView` as the API, so it learns the `InviteView` and nothing
 * else. An unknown token is the localized not-found page; a used, revoked or expired one the
 * kind page that names who can help. Anything else is a real failure for the error boundary.
 */
export default async function InvitePage({ params }: { params: Params }) {
  const { locale: urlLocale, token } = await params;
  const locale = resolveLocale(urlLocale);
  try {
    const view = await inviteView(token);
    return <InviteLanding locale={locale} token={token} view={view} />;
  } catch (error) {
    if (error instanceof HttpError && error.code === "not-found") notFound();
    if (error instanceof HttpError && isDeadInviteCode(error.code)) {
      return <InviteUnavailable locale={locale} code={error.code} />;
    }
    throw error;
  }
}
