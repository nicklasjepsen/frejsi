import { followPage, pageHeaders } from "@/lib/ios-pages/pages";

/**
 * `/follow`, where the iPhone app's links point (`/follow#<link>`). With the app installed iOS opens
 * the link in it; without, this static page says to install the app and tap the link again. The
 * fragment never reaches a server, and this page has no script that could read it.
 */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(followPage(), { headers: pageHeaders() });
}
