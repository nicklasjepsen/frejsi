import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { PeopleApiError } from "./api-client";
import type { CreatedInviteView, PeopleView } from "./contract";
import { PeopleScreen, type PeopleScreenProps } from "./PeopleScreen";

const api = vi.hoisted(() => ({
  load: vi.fn(),
  createInvite: vi.fn(),
  resendInvite: vi.fn(),
  revokeInvite: vi.fn(),
  changeRole: vi.fn(),
  removeMember: vi.fn(),
  removeDevice: vi.fn(),
}));
vi.mock("./api-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  peopleApi: api,
}));
const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: navigation.push,
    replace: vi.fn(),
    prefetch: vi.fn(),
    refresh: navigation.refresh,
  }),
}));

// 15 October 2026, 16:52 in Copenhagen.
const NOW = new Date("2026-10-15T14:52:00.000Z");
const TZ = "Europe/Copenhagen";
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

/** Alma's space as drawn on Personer-Desktop; the names are the design's fictional fixtures. */
const view: PeopleView = {
  members: [
    {
      userId: "u-jonas",
      name: "Jonas",
      role: "owner",
      simpleMode: false,
      lastSeen: ago(60_000),
      devices: [
        { id: "pk-j1", name: "iPhone", createdAt: ago(10 * DAY), lastUsedAt: ago(60_000) },
        { id: "pk-j2", name: "Mac", createdAt: ago(5 * DAY), lastUsedAt: ago(2 * DAY) },
      ],
    },
    {
      userId: "u-mette",
      name: "Mette",
      role: "owner",
      simpleMode: false,
      lastSeen: "2026-10-15T05:20:00.000Z",
      devices: [{ id: "pk-m1", name: "Android", createdAt: ago(9 * DAY), lastUsedAt: null }],
    },
    {
      userId: "u-alma",
      name: "Alma",
      role: "carer",
      simpleMode: true,
      lastSeen: "2026-10-15T12:52:00.000Z",
      devices: [
        {
          id: "pk-a1",
          name: "Almas iPhone",
          createdAt: ago(8 * DAY),
          lastUsedAt: "2026-10-15T12:52:00.000Z",
        },
      ],
    },
    {
      userId: "u-birthe",
      name: "Farmor Birthe",
      role: "carer",
      simpleMode: false,
      lastSeen: "2026-10-11T10:00:00.000Z",
      devices: [{ id: "pk-b1", name: null, createdAt: ago(7 * DAY), lastUsedAt: null }],
    },
    {
      userId: "u-laerke",
      name: "Lærke (skolen)",
      role: "viewer",
      simpleMode: false,
      lastSeen: null,
      devices: [],
    },
  ],
  invites: [
    {
      id: "inv-soeren",
      name: "Morfar Søren",
      role: "carer",
      createdAt: ago(DAY),
      expiresAt: new Date(NOW.getTime() + 6 * DAY + 3 * 60 * 60 * 1000).toISOString(),
    },
  ],
};

const created: CreatedInviteView = {
  id: "inv-new",
  url: "https://frejsi.example/invite/newtoken",
  name: "Morfar Søren",
  role: "carer",
  expiresAt: new Date(NOW.getTime() + 7 * DAY).toISOString(),
};

const base: PeopleScreenProps = {
  locale: "da",
  spaceId: "s1",
  spaceName: "Almas rum",
  timezone: TZ,
  currentUserId: "u-jonas",
  role: "owner",
  initial: view,
};

function mount(props: Partial<PeopleScreenProps> = {}, locale: AppLocale = "da") {
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)} timeZone={TZ}>
      <PeopleScreen {...base} {...props} locale={locale} />
    </I18nProvider>,
  );
}

const table = () => screen.getByRole("table", { name: "Personer" });
const memberRows = () => screen.getAllByTestId("member-row");
const rowOf = (name: string) =>
  memberRows().find((row) => within(row).queryByText(name) !== null) ?? expect.fail(name);
const detail = () => screen.getByTestId("member-detail");
/** The nth element of a query result, or a failure that names it. */
const nth = (list: HTMLElement[], index: number): HTMLElement => {
  const hit = list[index];
  if (!hit) throw new Error(`no element at ${index}`);
  return hit;
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  for (const fn of Object.values(api)) fn.mockReset();
  navigation.push.mockReset();
  navigation.refresh.mockReset();
  api.load.mockResolvedValue(view);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PeopleScreen · the list (Personer-Telefon, Personer-Desktop)", () => {
  it("heads the page with the space and the counts of people, devices and pending invitations", () => {
    mount();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Personer i Almas rum");
    expect(screen.getByTestId("people-summary")).toHaveTextContent(
      "5 personer · 5 enheder · 1 invitation venter",
    );
  });

  it("is a table with the columns Person, Rolle, Visning, Enheder and Sidst set", () => {
    mount();
    expect(
      within(table())
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Person", "Rolle", "Visning", "Enheder", "Sidst set"]);
  });

  it("shows every member with (dig) on the current user, the role, the view, the devices and when they were last seen", () => {
    mount();
    expect(memberRows()).toHaveLength(5);
    const jonas = rowOf("Jonas");
    expect(within(jonas).getByText("(dig)")).toBeInTheDocument();
    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole("cell")
        .map((c) => `${String(c.getAttribute("data-col"))}=${c.textContent}`);
    expect(cells(jonas).slice(1)).toEqual([
      "role=Ejer",
      "view=Normal",
      "devices=iPhone · Mac",
      "lastSeen=Nu",
    ]);
    expect(cells(rowOf("Mette")).slice(1)).toEqual([
      "role=Ejer",
      "view=Normal",
      "devices=Android",
      "lastSeen=I dag 07:20",
    ]);
    expect(cells(rowOf("Alma")).slice(1)).toEqual([
      "role=Hjælper",
      "view=Simpel visning",
      "devices=Almas iPhone",
      "lastSeen=I dag 14:52",
    ]);
    // An unnamed device shows the count; the weekday is capitalized in the table.
    expect(cells(rowOf("Farmor Birthe")).slice(1)).toEqual([
      "role=Hjælper",
      "view=Normal",
      "devices=1 enhed",
      "lastSeen=Søndag",
    ]);
    expect(within(rowOf("Mette")).queryByText("(dig)")).toBeNull();
  });

  it("writes the phone summary line role · devices, with simpel visning when it is on", () => {
    mount();
    expect(within(rowOf("Jonas")).getByTestId("member-summary")).toHaveTextContent(
      "Ejer · 2 enheder",
    );
    expect(within(rowOf("Alma")).getByTestId("member-summary")).toHaveTextContent(
      "Hjælper · simpel visning · 1 enhed",
    );
  });

  it("reads Ser med · ingen glukose on the viewer row, in the role cell and the phone line", () => {
    mount();
    const laerke = rowOf("Lærke (skolen)");
    expect(within(laerke).getByRole("cell", { name: "Ser med · ingen glukose" })).toHaveAttribute(
      "data-col",
      "role",
    );
    expect(within(laerke).getByTestId("member-summary")).toHaveTextContent(
      "Ser med · ingen glukose · 0 enheder",
    );
    expect(within(laerke).getByText("Aldrig")).toBeInTheDocument();
  });

  it("shows a pending invitation as a dashed-avatar row: sent yesterday, expires in 6 days, role, dashes", () => {
    mount();
    const row = screen.getByTestId("invite-row");
    expect(within(row).getByTestId("pending-avatar")).toBeInTheDocument();
    expect(within(row).getByText("Morfar Søren")).toBeInTheDocument();
    expect(row).toHaveTextContent("Invitation sendt i går · udløber om 6 dage");
    expect(within(row).getByRole("cell", { name: "Hjælper" })).toBeInTheDocument();
    expect(within(row).getAllByText("—")).toHaveLength(2);
    expect(within(row).getByRole("button", { name: "Send igen" })).toBeInTheDocument();
  });

  it("renders the device notices for phone and desktop", () => {
    mount();
    expect(screen.getByText(/Nyt telefonnummer eller ny telefon\?/)).toBeInTheDocument();
    expect(screen.getByText(/Enheder: ny telefon = ny enhed/)).toBeInTheDocument();
  });

  it("speaks English when the locale is en", () => {
    mount({}, "en");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("People in Almas rum");
    expect(within(rowOf("Jonas")).getByText("(you)")).toBeInTheDocument();
    expect(screen.getByTestId("invite-row")).toHaveTextContent(
      "Invitation sent yesterday · expires in 6 days",
    );
    expect(within(rowOf("Farmor Birthe")).getByText("Sunday")).toBeInTheDocument();
  });
});

describe("PeopleScreen · keyboard", () => {
  it("moves between rows with the arrow keys and opens a member with Enter or Space", () => {
    mount();
    const rows = memberRows();
    rows[0]?.focus();
    expect(rows[0]).toHaveFocus();
    fireEvent.keyDown(nth(rows, 0), { key: "ArrowDown" });
    expect(rows[1]).toHaveFocus();
    fireEvent.keyDown(nth(rows, 1), { key: "ArrowUp" });
    expect(rows[0]).toHaveFocus();
    fireEvent.keyDown(nth(rows, 0), { key: "End" });
    expect(screen.getByTestId("invite-row")).toHaveFocus();
    fireEvent.keyDown(screen.getByTestId("invite-row"), { key: "Home" });
    expect(rows[0]).toHaveFocus();

    fireEvent.keyDown(nth(rows, 1), { key: "Enter" });
    expect(rows[1]).toHaveAttribute("aria-expanded", "true");
    expect(detail()).toHaveTextContent("Android");
    fireEvent.keyDown(nth(rows, 1), { key: " " });
    expect(rows[1]).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("member-detail")).toBeNull();
  });
});

describe("PeopleScreen · a member's devices and role (design gap: phone detail)", () => {
  it("opens the member on click and lists the devices with when each was last seen", () => {
    mount();
    fireEvent.click(rowOf("Jonas"));
    const devices = within(detail()).getAllByTestId("device");
    expect(devices).toHaveLength(2);
    expect(devices[0]).toHaveTextContent("iPhone");
    expect(devices[0]).toHaveTextContent("sidst set nu");
    expect(devices[1]).toHaveTextContent("Mac");
    expect(devices[1]).toHaveTextContent("sidst set tirsdag");
    fireEvent.click(rowOf("Alma"));
    expect(within(detail()).getByTestId("device")).toHaveTextContent("sidst set i dag 14:52");
    fireEvent.click(rowOf("Farmor Birthe"));
    expect(within(detail()).getByTestId("device")).toHaveTextContent("Enhed");
    expect(within(detail()).getByTestId("device")).toHaveTextContent("ikke brugt endnu");
  });

  it("lets an owner remove a device after confirming, then reloads the list", async () => {
    api.removeDevice.mockResolvedValue(undefined);
    mount();
    fireEvent.click(rowOf("Jonas"));
    const mac = nth(within(detail()).getAllByTestId("device"), 1);
    fireEvent.click(within(mac).getByRole("button", { name: "Fjern" }));
    expect(api.removeDevice).not.toHaveBeenCalled();
    expect(mac).toHaveTextContent("Fjern Mac? Den logges ud med det samme.");
    fireEvent.click(within(mac).getByRole("button", { name: "Fortryd" }));
    expect(within(mac).queryByRole("button", { name: "Ja, fjern" })).toBeNull();
    fireEvent.click(within(mac).getByRole("button", { name: "Fjern" }));
    fireEvent.click(within(mac).getByRole("button", { name: "Ja, fjern" }));
    expect(api.removeDevice).toHaveBeenCalledWith("s1", "pk-j2");
    await waitFor(() => {
      expect(api.load).toHaveBeenCalledWith("s1");
    });
  });

  it("lets an owner make an add-a-device link for a member and shows its QR code and link", async () => {
    api.createInvite.mockResolvedValue({ ...created, name: "Mette", forUserId: "u-mette" });
    mount();
    fireEvent.click(rowOf("Mette"));
    fireEvent.click(within(detail()).getByRole("button", { name: "+ Tilføj en enhed" }));
    expect(api.createInvite).toHaveBeenCalledWith("s1", { forUserId: "u-mette" });
    await waitFor(() => {
      expect(
        within(detail()).getByRole("img", { name: "QR-kode til invitationen" }),
      ).toBeInTheDocument();
    });
    expect(detail()).toHaveTextContent(
      "Lad Mette scanne koden med den nye enhed, eller send linket til den.",
    );
    expect(detail()).toHaveTextContent("Gælder i 7 dage · kan bruges én gang");
    expect(within(detail()).getByTestId("invite-link")).toHaveTextContent(created.url);
    await waitFor(() => {
      expect(api.load).toHaveBeenCalled();
    });
  });

  it("shows the role as radio cards with the design's one-line explanations and changes it through the API", async () => {
    api.changeRole.mockResolvedValue(undefined);
    mount();
    fireEvent.click(rowOf("Farmor Birthe"));
    const group = within(detail()).getByRole("group", { name: "Rolle" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["carer", "viewer", "owner"]);
    expect(within(group).getByRole("radio", { name: /Hjælper/ })).toBeChecked();
    expect(group).toHaveTextContent("Logger måltider, godkender mad, ser kurven");
    expect(group).toHaveTextContent("Ser dagens måltider og kulhydrater. Aldrig glukose.");
    expect(group).toHaveTextContent("Alt, inkl. personer, enheder og indstillinger");
    fireEvent.click(within(group).getByRole("radio", { name: /Ser med/ }));
    expect(api.changeRole).toHaveBeenCalledWith("s1", "u-birthe", "viewer");
    await waitFor(() => {
      expect(api.load).toHaveBeenCalled();
    });
  });

  it("tells the owner kindly when the last owner cannot step down", async () => {
    api.changeRole.mockRejectedValue(new PeopleApiError(409, "last-owner"));
    mount();
    fireEvent.click(rowOf("Jonas"));
    fireEvent.click(within(detail()).getByRole("radio", { name: /Hjælper/ }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Et rum skal altid have mindst én ejer, så den sidste ejer kan ikke fjernes.",
      );
    });
    expect(api.load).not.toHaveBeenCalled();
  });

  it("lets an owner remove a member after confirming, then reloads", async () => {
    api.removeMember.mockResolvedValue(undefined);
    mount();
    fireEvent.click(rowOf("Farmor Birthe"));
    fireEvent.click(
      within(detail()).getByRole("button", { name: "Fjern Farmor Birthe fra rummet" }),
    );
    expect(detail()).toHaveTextContent("Fjern Farmor Birthe fra rummet? Enhederne logges ud");
    fireEvent.click(within(detail()).getByRole("button", { name: "Ja, fjern" }));
    expect(api.removeMember).toHaveBeenCalledWith("s1", "u-birthe");
    await waitFor(() => {
      expect(api.load).toHaveBeenCalledWith("s1");
    });
  });

  it("takes the owner-only controls away as soon as an owner has stepped down", async () => {
    api.changeRole.mockResolvedValue(undefined);
    api.load.mockResolvedValue({
      ...view,
      members: view.members.map((m) => (m.userId === "u-jonas" ? { ...m, role: "carer" } : m)),
    });
    mount();
    expect(screen.getByTestId("invite-panel")).toBeInTheDocument();
    fireEvent.click(rowOf("Jonas"));
    fireEvent.click(within(detail()).getByRole("radio", { name: /Hjælper/ }));
    expect(api.changeRole).toHaveBeenCalledWith("s1", "u-jonas", "carer");
    await waitFor(() => {
      expect(screen.queryByTestId("invite-panel")).toBeNull();
    });
    expect(within(detail()).queryByRole("group", { name: "Rolle" })).toBeNull();
    expect(screen.getByText(/Kun ejere kan invitere/)).toBeInTheDocument();
  });

  it("sends an owner who removes themselves to the front page instead of reloading a space they left", async () => {
    api.removeMember.mockResolvedValue(undefined);
    mount();
    fireEvent.click(rowOf("Jonas"));
    fireEvent.click(within(detail()).getByRole("button", { name: "Fjern Jonas fra rummet" }));
    fireEvent.click(within(detail()).getByRole("button", { name: "Ja, fjern" }));
    expect(api.removeMember).toHaveBeenCalledWith("s1", "u-jonas");
    await waitFor(() => {
      expect(navigation.push).toHaveBeenCalledWith("/da");
    });
    expect(navigation.refresh).toHaveBeenCalled();
    expect(api.load).not.toHaveBeenCalled();
  });

  it("gives a carer and a viewer the devices to read only: no role cards, no remove, no add-device, no invite", () => {
    for (const role of ["carer", "viewer"] as const) {
      mount({ role, currentUserId: "u-alma" });
      expect(screen.queryByRole("button", { name: "Invitér en person" })).toBeNull();
      expect(screen.queryByTestId("invite-panel")).toBeNull();
      expect(
        screen.getByText("Kun ejere kan invitere, skifte roller og fjerne personer og enheder."),
      ).toBeInTheDocument();
      fireEvent.click(rowOf("Jonas"));
      expect(within(detail()).getAllByTestId("device")).toHaveLength(2);
      expect(within(detail()).queryByRole("group", { name: "Rolle" })).toBeNull();
      expect(within(detail()).queryByRole("button", { name: "Fjern" })).toBeNull();
      expect(within(detail()).queryByRole("button", { name: "+ Tilføj en enhed" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Send igen" })).toBeNull();
      cleanup();
    }
  });
});

describe("PeopleScreen · inviting (Personer-Desktop panel, phone sheet)", () => {
  it("creates an invitation from the name and the role cards and shows the QR code, the link and the validity", async () => {
    api.createInvite.mockResolvedValue(created);
    mount();
    const panel = screen.getByTestId("invite-panel");
    expect(panel).toHaveAttribute("data-open", "false");
    fireEvent.click(screen.getByRole("button", { name: "Invitér en person" }));
    expect(panel).toHaveAttribute("data-open", "true");

    const group = within(panel).getByRole("group", { name: "Rolle" });
    expect(within(group).getByRole("radio", { name: /Hjælper/ })).toBeChecked();
    fireEvent.change(within(panel).getByLabelText("Navn"), { target: { value: "Morfar Søren" } });
    fireEvent.click(within(group).getByRole("radio", { name: /Ser med/ }));
    fireEvent.submit(within(panel).getByTestId("invite-form"));
    expect(api.createInvite).toHaveBeenCalledWith("s1", { name: "Morfar Søren", role: "viewer" });

    await waitFor(() => {
      expect(
        within(panel).getByRole("img", { name: "QR-kode til invitationen" }),
      ).toBeInTheDocument();
    });
    expect(panel).toHaveTextContent("Lad Morfar Søren scanne koden, eller send linket.");
    expect(panel).toHaveTextContent("Gælder i 7 dage · kan bruges én gang");
    expect(within(panel).getByTestId("invite-link")).toHaveTextContent(created.url);
    expect(within(panel).getByRole("button", { name: "Kopiér link" })).toBeInTheDocument();
    await waitFor(() => {
      expect(api.load).toHaveBeenCalledWith("s1");
    });

    fireEvent.click(within(panel).getByRole("button", { name: "Ny invitation" }));
    expect(within(panel).getByLabelText("Navn")).toHaveValue("");
    expect(within(panel).queryByTestId("invite-link")).toBeNull();
  });

  it("does not send a blank name", () => {
    mount();
    const panel = screen.getByTestId("invite-panel");
    fireEvent.change(within(panel).getByLabelText("Navn"), { target: { value: "   " } });
    fireEvent.submit(within(panel).getByTestId("invite-form"));
    expect(api.createInvite).not.toHaveBeenCalled();
  });

  it("copies the link with Kopiér link and says so", async () => {
    api.createInvite.mockResolvedValue(created);
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount();
    const panel = screen.getByTestId("invite-panel");
    fireEvent.change(within(panel).getByLabelText("Navn"), { target: { value: "Morfar Søren" } });
    fireEvent.submit(within(panel).getByTestId("invite-form"));
    const copy = await within(panel).findByRole("button", { name: "Kopiér link" });
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith(created.url);
    await waitFor(() => {
      expect(within(panel).getByRole("status")).toHaveTextContent("Linket er kopieret");
    });
  });

  it("Send igen asks the API for a new link and shows it under the pending row", async () => {
    api.resendInvite.mockResolvedValue(created);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Send igen" }));
    expect(api.resendInvite).toHaveBeenCalledWith("s1", "inv-soeren");
    const result = await screen.findByTestId("invite-result");
    expect(
      within(result).getByRole("img", { name: "QR-kode til invitationen" }),
    ).toBeInTheDocument();
    expect(within(result).getByTestId("invite-link")).toHaveTextContent(created.url);
    await waitFor(() => {
      expect(api.load).toHaveBeenCalledWith("s1");
    });
  });

  it("Træk tilbage revokes the invitation and reloads", async () => {
    api.revokeInvite.mockResolvedValue(undefined);
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Træk tilbage" }));
    expect(api.revokeInvite).toHaveBeenCalledWith("s1", "inv-soeren");
    await waitFor(() => {
      expect(api.load).toHaveBeenCalledWith("s1");
    });
  });

  it("shows the API's reason when inviting fails, translated by code", async () => {
    api.createInvite.mockRejectedValue(new PeopleApiError(403, "forbidden"));
    mount();
    const panel = screen.getByTestId("invite-panel");
    fireEvent.change(within(panel).getByLabelText("Navn"), { target: { value: "Someone" } });
    fireEvent.submit(within(panel).getByTestId("invite-form"));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Det her har du ikke adgang til.");
    });
  });
});

describe("PeopleScreen · styling", () => {
  it("colours only through the design tokens, so dark mode and the accent follow the shell", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "people.module.css"), "utf8");
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\brgb\(|\bhsl\(/);
    expect(css).toMatch(/var\(--accent-/);
    expect(css).toMatch(/dashed/);
  });

  it("has no glucose anywhere on the page", () => {
    const { container } = mount();
    expect(container.textContent).not.toMatch(/mmol|mg\/dL|blodsukker|\d,\d/i);
  });
});
