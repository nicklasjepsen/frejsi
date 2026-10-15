import { assertOrigin, startLogin } from "@/lib/auth/webauthn";

import { json, route } from "../../http";

/** Starts a returning sign-in with a discoverable credential: no username (spec §2b). */
export const POST = route("auth/login/options", async (request) => {
  assertOrigin(request.headers.get("origin"));
  return json(await startLogin());
});
