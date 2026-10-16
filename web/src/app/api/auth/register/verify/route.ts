import { log } from "@frejsi/shared";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { z } from "zod";

import { assertOrigin, finishRegistration } from "@/lib/auth/webauthn";
import { themeCookie } from "@/lib/theme/theme";

import { json, parseBody, route, sessionCookie } from "../../http";

/** What `@simplewebauthn/browser`'s `startRegistration()` returns; the library checks the rest. */
const Body = z.object({
  challengeId: z.string().min(1),
  deviceName: z.string().trim().min(1).max(60).optional(),
  response: z.looseObject({
    id: z.string().min(1),
    rawId: z.string().min(1),
    type: z.literal("public-key"),
    response: z.looseObject({
      clientDataJSON: z.string().min(1),
      attestationObject: z.string().min(1),
      transports: z.array(z.string()).optional(),
    }),
    clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
  }),
});

/**
 * Finishes registration: the passkey, the user and membership (or only the passkey for an
 * add-a-device link), the session and its cookie, all in one transaction (spec §2b).
 */
export const POST = route("auth/register/verify", async (request) => {
  assertOrigin(request.headers.get("origin"));
  const body = await parseBody(request, Body);
  const result = await finishRegistration({
    challengeId: body.challengeId,
    response: body.response as RegistrationResponseJSON,
    ...(body.deviceName ? { deviceName: body.deviceName } : {}),
  });
  log.info("auth.registered", {
    route: "auth/register/verify",
    userId: result.userId,
    spaceId: result.spaceId,
  });
  return json(
    { userId: result.userId, spaceId: result.spaceId, role: result.role },
    { cookie: [sessionCookie(result.sessionId), themeCookie(result.theme)] },
  );
});
