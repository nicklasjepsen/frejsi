import "@testing-library/jest-dom/vitest";

import type { Reading } from "@frejsi/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";
import type { LiveState } from "@/lib/live/live-feed";

const live = vi.hoisted(() => ({ state: null as LiveState | null }));
vi.mock("@/lib/live/useLiveFeed", async () => {
  const { useState } = await import("react");
  return {
    useLiveFeed: () => {
      const [state, setState] = useState<LiveState>(() => {
        if (!live.state) throw new Error("the test sets a state first");
        return live.state;
      });
      return {
        ...state,
        events: [],
        subscribe: () => () => undefined,
        addReading: (reading: Reading) => {
          setState((current) => ({
            ...current,
            readings: [...current.readings.filter((r) => r.ts !== reading.ts), reading],
            latest: reading,
          }));
        },
      };
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

import { NowScreen, type NowScreenProps } from "./NowScreen";

const T0 = new Date("2026-10-14T13:13:00.000Z"); // Wednesday 15:13 in Copenhagen
const minutesAgo = (m: number) => new Date(T0.getTime() - m * 60_000).toISOString();

const manualSpace: NonNullable<LiveState["space"]> = {
  glucoseUnit: "mmol",
  targetLow: 4,
  targetHigh: 10,
  timezone: "Europe/Copenhagen",
  sourceType: "manual",
};
const emptyManual: LiveState = {
  loaded: true,
  connection: "live",
  lastSeq: 3,
  readings: [],
  latest: null,
  sourceStatus: "connected",
  sourceSince: null,
  space: manualSpace,
  error: null,
};
const base: NowScreenProps = {
  spaceId: "s1",
  locale: "da",
  simpleMode: false,
  timeZone: "Europe/Copenhagen",
};

let posts: { path: string; body: Record<string, unknown> }[];
let respond: (body: Record<string, unknown>) => Response;

function mount(props: Partial<NowScreenProps> = {}, locale: AppLocale = "da") {
  const slot = document.createElement("div");
  slot.id = "shell-header-end";
  document.body.appendChild(slot);
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      <NowScreen {...base} {...props} locale={locale} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  live.state = emptyManual;
  posts = [];
  respond = (body) =>
    new Response(
      JSON.stringify({
        ts: T0.toISOString(),
        mmol: body.unit === "mgdl" ? 6.2 : body.value,
        trend: "not-computable",
      }),
    );
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (init?.method === "POST" && path.endsWith("/readings")) {
      const body = JSON.parse(typeof init.body === "string" ? init.body : "{}") as Record<
        string,
        unknown
      >;
      posts.push({ path, body });
      return Promise.resolve(respond(body));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const openSheet = () => {
  fireEvent.click(
    within(screen.getByTestId("now-phone")).getByRole("button", { name: "Indtast måling" }),
  );
  return screen.getByTestId("manual-sheet");
};
const type = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

describe("Nu · Manuelt", () => {
  it("offers 'Indtast måling' on the phone under the hero and on the desktop status line", () => {
    mount();
    expect(
      within(screen.getByTestId("now-phone")).getByRole("button", { name: "Indtast måling" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("now-desktop")).getByRole("button", { name: "Indtast måling" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("now-phone")).toHaveTextContent("Ingen målinger endnu");
  });

  it("omits the button for a sensor space, for a viewer and on the simpleMode Now", () => {
    live.state = { ...emptyManual, space: { ...manualSpace, sourceType: "dexcom-share" } };
    mount();
    expect(screen.queryByRole("button", { name: "Indtast måling" })).toBeNull();
    cleanup();
    live.state = emptyManual;
    mount({ role: "viewer" });
    expect(screen.queryByRole("button", { name: "Indtast måling" })).toBeNull();
    cleanup();
    mount({ simpleMode: true });
    expect(screen.queryByRole("button", { name: "Indtast måling" })).toBeNull();
  });

  it("opens the sheet with 'Nu' pressed, a time field and 'Gem måling'", () => {
    mount();
    const sheet = within(openSheet());
    expect(sheet.getByRole("button", { name: "Nu" })).toHaveAttribute("aria-pressed", "true");
    expect(sheet.getByLabelText("Tidspunkt")).toHaveValue("15:13");
    expect(sheet.getByLabelText("Måling i mmol/L")).toHaveAttribute("inputmode", "decimal");
    expect(sheet.getByRole("button", { name: "Gem måling" })).toBeInTheDocument();
  });

  it("saves with a decimal comma and shows the value with its age, no arrow and no trend word", async () => {
    mount();
    openSheet();
    type("Måling i mmol/L", "6,2");
    fireEvent.click(screen.getByRole("button", { name: "Gem måling" }));
    await waitFor(() => {
      expect(
        within(screen.getByTestId("now-phone")).getByTestId("glucose-number"),
      ).toHaveTextContent("6,2");
    });
    expect(posts).toEqual([
      { path: "/api/spaces/s1/readings", body: { value: 6.2, unit: "mmol" } },
    ]);
    const phone = within(screen.getByTestId("now-phone"));
    expect(phone.getByTestId("glucose-age")).toHaveTextContent("mmol/L · lige nu");
    expect(phone.queryByRole("img", { name: /stiger|falder|stabil|retning/ })).toBeNull();
    expect(phone.getByTestId("glucose-age")).not.toHaveTextContent("retning");
    expect(screen.queryByTestId("manual-sheet")).toBeNull();
  });

  it("sends a chosen time as an ISO instant in the space's zone, yesterday's when it is later than now", async () => {
    mount();
    openSheet();
    type("Måling i mmol/L", "7.4");
    fireEvent.change(screen.getByLabelText("Tidspunkt"), { target: { value: "14:45" } });
    expect(screen.getByRole("button", { name: "Nu" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Gem måling" }));
    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    expect(posts[0]?.body).toEqual({ value: 7.4, unit: "mmol", ts: "2026-10-14T12:45:00.000Z" });
    cleanup();

    posts = [];
    mount();
    openSheet();
    type("Måling i mmol/L", "5");
    fireEvent.change(screen.getByLabelText("Tidspunkt"), { target: { value: "16:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem måling" }));
    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    expect(posts[0]?.body).toEqual({ value: 5, unit: "mmol", ts: "2026-10-13T14:00:00.000Z" });
  });

  it("takes whole numbers in a mg/dL space, shows 112 in the hero and sends the typed number", async () => {
    live.state = { ...emptyManual, space: { ...manualSpace, glucoseUnit: "mgdl" } };
    mount();
    openSheet();
    const field = screen.getByLabelText("Måling i mg/dL");
    expect(field).toHaveAttribute("inputmode", "numeric");
    fireEvent.change(field, { target: { value: "6,2" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem måling" }));
    expect(
      await screen.findByText("Tallet ser ikke rigtigt ud – tjek enheden"),
    ).toBeInTheDocument();
    expect(posts).toEqual([]);

    fireEvent.change(field, { target: { value: "112" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem måling" }));
    await waitFor(() => {
      expect(
        within(screen.getByTestId("now-phone")).getByTestId("glucose-number"),
      ).toHaveTextContent("112");
    });
    expect(posts[0]?.body).toEqual({ value: 112, unit: "mgdl" });
    expect(within(screen.getByTestId("now-phone")).getByTestId("glucose-age")).toHaveTextContent(
      "mg/dL · lige nu",
    );
  });

  it("says the number does not look right for 45 mmol/L, before and after the server", async () => {
    mount();
    openSheet();
    type("Måling i mmol/L", "45");
    fireEvent.click(screen.getByRole("button", { name: "Gem måling" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tallet ser ikke rigtigt ud – tjek enheden",
    );
    expect(posts).toEqual([]);

    respond = () =>
      new Response(JSON.stringify({ error: { code: "validation", message: "" } }), { status: 400 });
    type("Måling i mmol/L", "6.2");
    fireEvent.click(screen.getByRole("button", { name: "Gem måling" }));
    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("Tallet ser ikke rigtigt ud");
  });

  it("says the time must be within the last day when the server finds it outside the window", async () => {
    respond = () =>
      new Response(JSON.stringify({ error: { code: "reading-out-of-window", message: "" } }), {
        status: 400,
      });
    mount();
    openSheet();
    type("Måling i mmol/L", "6.2");
    fireEvent.change(screen.getByLabelText("Tidspunkt"), { target: { value: "15:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem måling" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tidspunktet skal være inden for det sidste døgn",
    );
  });

  it("says why when the space is no longer Manuelt, in the error's own words", async () => {
    respond = () =>
      new Response(JSON.stringify({ error: { code: "source-not-manual", message: "" } }), {
        status: 409,
      });
    mount();
    openSheet();
    type("Måling i mmol/L", "6.2");
    fireEvent.click(screen.getByRole("button", { name: "Gem måling" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("kun taste målinger ind");
  });

  it("reads 'Manuelt' in the header pill and 'Manuelt · sidste måling 15:03' on the desktop line", () => {
    live.state = {
      ...emptyManual,
      readings: [{ ts: minutesAgo(10), mmol: 6.2, trend: "not-computable" }],
      latest: { ts: minutesAgo(10), mmol: 6.2, trend: "not-computable" },
    };
    mount();
    const header = document.getElementById("shell-header-end");
    if (!header) throw new Error("the header slot is mounted by the test");
    expect(within(header).getByRole("status")).toHaveTextContent(/^Manuelt$/);
    expect(within(screen.getByTestId("now-desktop")).getByRole("status")).toHaveTextContent(
      "Manuelt · sidste måling 15:03",
    );
  });

  it("is English in en", () => {
    mount({}, "en");
    expect(
      within(screen.getByTestId("now-phone")).getByRole("button", { name: "Enter reading" }),
    ).toBeInTheDocument();
  });
});

describe("Nu · a disconnected Nightscout space", () => {
  it("reads 'Ingen forbindelse til Nightscout siden 14:03' from source.nightscout.name", () => {
    live.state = {
      ...emptyManual,
      space: { ...manualSpace, sourceType: "nightscout" },
      sourceStatus: "disconnected",
      sourceSince: minutesAgo(70),
      readings: [{ ts: minutesAgo(80), mmol: 6.2, trend: "flat" }],
      latest: { ts: minutesAgo(80), mmol: 6.2, trend: "flat" },
    };
    mount();
    expect(screen.getByText("Ingen forbindelse til Nightscout siden 14:03")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Indtast måling" })).toBeNull();
  });
});
