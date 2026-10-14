import { describe, expect, it } from "vitest";

import {
  PII_PROPERTY_NAMES,
  stripPii,
  trackEvent,
  _resetTelemetryForTests,
  type TelemetryEnvelope,
} from "./telemetry";

describe("telemetry PII initializer", () => {
  it("strips name, email, username, password, mmol and photo from properties and measurements", () => {
    const envelope: TelemetryEnvelope = {
      data: {
        baseType: "EventData",
        baseData: {
          name: "reading.stored",
          properties: {
            spaceId: "s1",
            name: "Example Person",
            Email: "person@example.invalid",
            username: "publisher",
            password: "hunter2",
            mmol: "6.2",
            photo: "data:image/png;base64,AAAA",
          },
          measurements: { count: 1, mmol: 6.2 },
        },
      },
    };
    expect(stripPii(envelope)).toBe(true);
    expect(envelope.data?.baseData?.properties).toEqual({ spaceId: "s1" });
    expect(envelope.data?.baseData?.measurements).toEqual({ count: 1 });
    expect(envelope.data?.baseData?.name).toBe("reading.stored");
    expect([...PII_PROPERTY_NAMES]).toEqual([
      "name",
      "email",
      "username",
      "password",
      "mmol",
      "photo",
    ]);
  });

  it("strips request bodies", () => {
    const envelope: TelemetryEnvelope = {
      data: {
        baseType: "RequestData",
        baseData: {
          name: "POST /api/bootstrap",
          url: "https://example.invalid/api/bootstrap",
          body: '{"ownerName":"Example Person"}',
          properties: {
            requestBody: '{"ownerName":"Example Person"}',
            responseBody: "{}",
            route: "/api/bootstrap",
          },
        },
      },
    };
    stripPii(envelope);
    expect(JSON.stringify(envelope)).not.toContain("Example Person");
    expect(envelope.data?.baseData?.properties).toEqual({ route: "/api/bootstrap" });
    expect(envelope.data?.baseData?.body).toBeUndefined();
  });

  it("tolerates an envelope without data", () => {
    expect(stripPii({})).toBe(true);
  });
});

describe("trackEvent", () => {
  it("strips the same properties before handing the event to the client", () => {
    const events: { name: string; properties?: Record<string, string> }[] = [];
    _resetTelemetryForTests({
      trackEvent: (event) => {
        events.push(event);
      },
    });
    trackEvent("reading.stored", { spaceId: "s1", name: "Example Person", mmol: "6.2" });
    expect(events).toEqual([{ name: "reading.stored", properties: { spaceId: "s1" } }]);
    _resetTelemetryForTests(null);
  });

  it("is a no-op when telemetry was never started", () => {
    _resetTelemetryForTests(null);
    expect(() => {
      trackEvent("reading.stored", { spaceId: "s1" });
    }).not.toThrow();
  });
});
