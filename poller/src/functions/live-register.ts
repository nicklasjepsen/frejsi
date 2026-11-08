import { app } from "@azure/functions";
import { createSecretsFromEnv, log, prisma, type Secrets } from "@naensom/shared";

import {
  CHECK_LIMIT,
  createLiveRegisterHandler,
  createLiveUnregisterHandler,
  nightscoutValidator,
  RateLimiter,
  REQUEST_LIMIT,
} from "../live/register";
import { PrismaLiveStore } from "../live/store";

// Per Function App instance (docs: poller/README.md, "iPhone push relay").
const requests = new RateLimiter(REQUEST_LIMIT.max, REQUEST_LIMIT.windowMs);
const checks = new RateLimiter(CHECK_LIMIT.max, CHECK_LIMIT.windowMs);
const store = new PrismaLiveStore(prisma);
let secrets: Secrets | undefined;
const secretsOnce = () => (secrets ??= createSecretsFromEnv());

// Anonymous: the iPhone app holds no function key. Create needs a working Nightscout token; update
// and delete need the device secret the create answered.
app.http("live-register", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "live/register",
  handler: (request) =>
    createLiveRegisterHandler({
      store,
      secrets: secretsOnce(),
      validate: nightscoutValidator(),
      requests,
      checks,
      now: Date.now,
      log,
    })(request),
});

app.http("live-unregister", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "live/register/{subscriptionId}",
  handler: (request) =>
    createLiveUnregisterHandler({ store, secrets: secretsOnce(), requests, now: Date.now, log })(
      request,
    ),
});
