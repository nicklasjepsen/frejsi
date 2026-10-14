import { app } from "@azure/functions";
import { startTelemetry } from "@frejsi/shared";

// Azure Functions v4 programming model: `package.json#main` is `dist/{index,functions/*}.js`, so
// each file under src/functions/ registers its own trigger (poll.ts, source-connect.ts) and this
// entry only sets up what every function shares.
app.setup({ enableHttpStream: false });

void startTelemetry();
