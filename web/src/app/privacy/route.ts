import type { NextRequest } from "next/server";

import { iosPageLocale, pageHeaders, privacyController, textPage } from "@/lib/ios-pages/pages";

/**
 * `/privacy` for the iPhone app, in the browser's language or the one `?lang=` names, naming the
 * deployment's `PRIVACY_CONTROLLER` as the data controller when it is set.
 */
export const dynamic = "force-dynamic";

export function GET(request: NextRequest): Response {
  const lang = iosPageLocale(
    request.nextUrl.searchParams.get("lang"),
    request.headers.get("accept-language"),
  );
  return new Response(textPage("privacy", lang, privacyController()), {
    headers: pageHeaders({ "Content-Language": lang, Vary: "Accept-Language" }),
  });
}
