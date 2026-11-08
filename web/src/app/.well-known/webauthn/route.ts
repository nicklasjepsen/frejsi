import { NextResponse } from "next/server";

import { appOrigins } from "@/lib/auth/core";

export const dynamic = "force-dynamic";

/**
 * `GET /.well-known/webauthn`: the WebAuthn related origins list. A browser signing in on an
 * origin whose host is not the RP ID (`PASSKEY_RP_ID`) fetches this from the RP ID's host and
 * lets the passkey through when the origin is listed. Every origin the app answers on is listed,
 * so a passkey made at the old address works at the new one. Public: it holds addresses only.
 */
export function GET(): NextResponse {
  return NextResponse.json(
    { origins: appOrigins() },
    { headers: { "cache-control": "public, max-age=300" } },
  );
}
