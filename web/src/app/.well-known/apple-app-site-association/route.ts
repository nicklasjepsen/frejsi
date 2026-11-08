import { APPLE_APP_SITE_ASSOCIATION } from "@/lib/ios-pages/aasa";

/**
 * Apple fetches this to let `/follow` links open the iPhone app. It must answer 200 with
 * `application/json` and no redirect; the middleware skips paths with a dot, so it never redirects.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(JSON.stringify(APPLE_APP_SITE_ASSOCIATION), {
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  });
}
