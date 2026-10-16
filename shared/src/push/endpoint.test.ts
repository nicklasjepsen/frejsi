import { expect, it } from "vitest";
import { pushEndpointAllowed } from "./endpoint";
it("accepts browser push services and rejects arbitrary outbound request destinations", () => {
  for (const url of [
    "https://fcm.googleapis.com/fcm/send/fictional",
    "https://updates.push.services.mozilla.com/wpush/v2/fictional",
    "https://web.push.apple.com/fictional",
    "https://fictional.notify.windows.com/fictional",
  ])
    expect(pushEndpointAllowed(url), url).toBe(true);
  for (const url of [
    "https://127.0.0.1/private",
    "https://169.254.169.254/",
    "https://localhost/",
    "https://fcm.googleapis.com.attacker.example/",
    "https://fcm.googleapis.com:8443/",
    "http://fcm.googleapis.com/",
    "https://user:pass@fcm.googleapis.com/",
    "not a url",
  ])
    expect(pushEndpointAllowed(url), url).toBe(false);
});
