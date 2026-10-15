import { log } from "@frejsi/shared";
import { z } from "zod";

import { startRegistration, assertOrigin } from "@/lib/auth/webauthn";

import { json, parseBody, route } from "../../http";

const Body = z.object({ inviteToken: z.string().min(1) });

/** Starts passkey registration from an invitation link (spec §2b). Public: the token is the key. */
export const POST = route("auth/register/options", async (request) => {
  assertOrigin(request.headers.get("origin"));
  const { inviteToken } = await parseBody(request, Body);
  const started = await startRegistration(inviteToken);
  log.info("auth.register.started", { route: "auth/register/options" });
  return json(started);
});
