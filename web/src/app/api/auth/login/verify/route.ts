import { log } from "@frejsi/shared";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";

import { assertOrigin, finishLogin } from "@/lib/auth/webauthn";
import { themeCookie } from "@/lib/theme/theme";

import { json, parseBody, route, sessionCookie } from "../../http";

/** What `@simplewebauthn/browser`'s `startAuthentication()` returns; the library checks the rest. */
const Body = z.object({
  challengeId: z.string().min(1),
  response: z.looseObject({
    id: z.string().min(1),
    rawId: z.string().min(1),
    type: z.literal("public-key"),
    response: z.looseObject({
      clientDataJSON: z.string().min(1),
      authenticatorData: z.string().min(1),
      signature: z.string().min(1),
      userHandle: z.string().optional(),
    }),
    clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  }),
});

/**
 * Finishes a sign-in: counter check, passkey and user bookkeeping, a new session and its cookie,
 * and the theme cookie from the stored preference so the first page paints right.
 */
export const POST = route("auth/login/verify", async (request) => {
  assertOrigin(request.headers.get("origin"));
  const body = await parseBody(request, Body);
  const result = await finishLogin({
    challengeId: body.challengeId,
    response: body.response as AuthenticationResponseJSON,
  });
  log.info("auth.login", { route: "auth/login/verify", userId: result.userId });
  return json(
    { userId: result.userId },
    { cookie: [sessionCookie(result.sessionId), themeCookie(result.theme)] },
  );
});
