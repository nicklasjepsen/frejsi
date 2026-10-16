// A fictional Nightscout over https, for checking Settings -> Glukosekilde -> Nightscout against the
// Compose stack (docker/README.md). Serves the two endpoints the adapter calls with made-up values.
// Not part of any image; run by docker/verify/compose.nightscout.yaml.
import { readFileSync } from "node:fs";
import { createServer } from "node:https";

const server = createServer(
  { key: readFileSync("/certs/key.pem"), cert: readFileSync("/certs/cert.pem") },
  (request, response) => {
    const path = new URL(request.url ?? "/", "https://nightscout.fixture.test").pathname;
    response.setHeader("content-type", "application/json");
    if (path === "/api/v1/verifyauth") {
      response.end(
        JSON.stringify({ status: 200, message: { canRead: true, canWrite: false, message: "OK" } }),
      );
    } else if (path === "/api/v1/entries/sgv.json") {
      const now = Date.now();
      const entries = [0, 1, 2].map((i) => ({
        _id: `fictional-${String(i)}`,
        device: "fictional-uploader",
        date: now - i * 60_000,
        dateString: new Date(now - i * 60_000).toISOString(),
        sgv: 120 + i,
        direction: "Flat",
        type: "sgv",
      }));
      response.end(JSON.stringify(entries));
    } else {
      response.statusCode = 404;
      response.end("{}");
    }
  },
);
server.listen(443, () => console.log("fixture nightscout listening"));
