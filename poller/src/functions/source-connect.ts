import { app } from "@azure/functions";
import { createSecretsFromEnv } from "@naensom/shared";

import { createSourceConnectHandler } from "../source-connect-handler";

app.http("source-connect", {
  methods: ["POST"],
  authLevel: "function",
  route: "source-connect",
  handler: (request, context) =>
    createSourceConnectHandler({ secrets: createSecretsFromEnv() })(request, context),
});
