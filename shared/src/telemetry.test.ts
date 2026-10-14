import { describe, expect, it } from "vitest";

import {
  _resetTelemetryForTests,
  PII_PROPERTY_NAMES,
  piiLogRecordProcessor,
  piiSpanProcessor,
  startTelemetry,
  stripPii,
  trackEvent,
  type TelemetrySdk,
} from "./telemetry";

describe("stripPii", () => {
  it("removes name, email, username, password, mmol and photo, case-insensitively, and request bodies", () => {
    const bag: Record<string, unknown> = {
      spaceId: "s1",
      name: "Example Person",
      Email: "person@example.invalid",
      username: "publisher",
      password: "hunter2",
      mmol: "6.2",
      photo: "data:image/png;base64,AAAA",
      body: '{"ownerName":"Example Person"}',
      requestBody: "{}",
      responseBody: "{}",
      "http.request.body": "{}",
      "user.name": "Example Person",
    };
    stripPii(bag);
    expect(bag).toEqual({ spaceId: "s1" });
    expect([...PII_PROPERTY_NAMES]).toEqual([
      "name",
      "email",
      "username",
      "password",
      "mmol",
      "photo",
    ]);
  });
});

describe("processors on the SDK's own record shapes", () => {
  it("strip a custom event the way applicationinsights' trackEvent emits it", () => {
    // applicationinsights 3.x: properties become attributes, baseData is the body.
    const record = {
      attributes: {
        spaceId: "s1",
        name: "Example Person",
        mmol: "6.2",
        "_MS.baseType": "EventData",
      } as Record<string, unknown>,
      body: {
        name: "reading.stored",
        measurements: { count: 1, mmol: 6.2 },
        properties: { photo: "x", route: "/api/x" },
        version: 2,
      } as Record<string, unknown>,
    };
    piiLogRecordProcessor.onEmit(record);
    expect(record.attributes).toEqual({ spaceId: "s1", "_MS.baseType": "EventData" });
    // The event's own name is not a property; it stays.
    expect(record.body).toEqual({
      name: "reading.stored",
      measurements: { count: 1 },
      properties: { route: "/api/x" },
      version: 2,
    });
  });

  it("strip a request span's attributes at start and at end", () => {
    const span = {
      attributes: {
        "http.route": "/api/bootstrap",
        "http.request.body": '{"ownerName":"Example Person"}',
        "enduser.name": "Example Person",
        name: "x",
      } as Record<string, unknown>,
    };
    piiSpanProcessor.onStart(span);
    expect(span.attributes).toEqual({ "http.route": "/api/bootstrap" });
    span.attributes.password = "hunter2";
    piiSpanProcessor.onEnd(span);
    expect(span.attributes).toEqual({ "http.route": "/api/bootstrap" });
  });

  it("tolerate a record without a body and flush/shutdown cleanly", async () => {
    expect(() => {
      piiLogRecordProcessor.onEmit({ attributes: {} });
    }).not.toThrow();
    await expect(piiSpanProcessor.forceFlush()).resolves.toBeUndefined();
    await expect(piiLogRecordProcessor.shutdown()).resolves.toBeUndefined();
  });
});

describe("startTelemetry", () => {
  it("registers both processors through useAzureMonitor with the connection string, once", async () => {
    _resetTelemetryForTests(null);
    const calls: unknown[] = [];
    const emitted: unknown[] = [];
    const sdk: TelemetrySdk = {
      useAzureMonitor: (options) => {
        calls.push(options);
      },
      getLogger: () => ({
        emit: (record) => {
          emitted.push(record);
        },
      }),
    };
    const env = {
      APPLICATIONINSIGHTS_CONNECTION_STRING:
        "InstrumentationKey=00000000-0000-0000-0000-000000000000",
    };
    await startTelemetry(env, () => Promise.resolve(sdk));
    await startTelemetry(env, () => Promise.resolve(sdk));
    expect(calls).toEqual([
      {
        azureMonitorExporterOptions: {
          connectionString: env.APPLICATIONINSIGHTS_CONNECTION_STRING,
        },
        spanProcessors: [piiSpanProcessor],
        logRecordProcessors: [piiLogRecordProcessor],
      },
    ]);

    trackEvent("reading.stored", { spaceId: "s1", name: "Example Person", mmol: "6.2" });
    expect(emitted).toEqual([
      {
        attributes: { spaceId: "s1", "_MS.baseType": "EventData" },
        body: { name: "reading.stored", version: 2 },
      },
    ]);
    _resetTelemetryForTests(null);
  });

  it("does nothing without a connection string", async () => {
    _resetTelemetryForTests(null);
    let loaded = false;
    await startTelemetry({}, () => {
      loaded = true;
      return Promise.reject(new Error("should not load"));
    });
    expect(loaded).toBe(false);
    expect(() => {
      trackEvent("reading.stored", { spaceId: "s1" });
    }).not.toThrow();
  });
});
