import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import { HttpError, type InviteView } from "@frejsi/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { INVITE_TTL_MS } from "@/lib/auth/invites";
import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { CeremonyError } from "../passkey-client";
import pub from "../public.module.css";

const mocks = vi.hoisted(() => ({
  view: null as InviteView | null,
  error: null as Error | null,
  register: vi.fn(),
  switchSpace: vi.fn<(form: FormData) => Promise<void>>(),
  navigate: vi.fn<(href: string) => void>(),
}));
vi.mock("../navigate", () => ({
  navigate: (href: string) => {
    mocks.navigate(href);
  },
}));
vi.mock("@/app/api/invites/invite-view", () => ({
  inviteView: (token: string) => {
    mocks.register.mockClear();
    if (mocks.error) return Promise.reject(mocks.error);
    if (!mocks.view) return Promise.reject(new Error(`no view for ${token}`));
    return Promise.resolve(mocks.view);
  },
}));
vi.mock("../passkey-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  registerWithInvite: (...args: unknown[]) => mocks.register(...args) as Promise<unknown>,
}));
vi.mock("@/components/shell/actions", () => ({
  switchSpace: (form: FormData) => mocks.switchSpace(form),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import InvitePage, { generateMetadata } from "./page";

/** Fictional fixtures from the artboards (docs/design/README.md): Søren, Alma, Jonas. */
const soren: InviteView = {
  name: "Søren",
  spaceName: "Almas rum",
  role: "carer",
  inviterName: "Jonas",
  daysLeft: 6,
  forExistingUser: false,
};

const TOKEN = "example-token-abc";

async function open(locale: AppLocale = "da", token = TOKEN) {
  const ui = (await InvitePage({ params: Promise.resolve({ locale, token }) })) as ReactElement;
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      {ui}
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.view = null;
  mocks.error = null;
  mocks.register.mockReset();
  mocks.switchSpace.mockReset();
  mocks.navigate.mockReset();
});

/** What the landing told the shell: the locale and the space this device should open. */
const chosen = () => {
  const form = mocks.switchSpace.mock.calls[0]?.[0];
  return form ? { locale: form.get("locale"), spaceId: form.get("spaceId") } : null;
};

describe("GET /[locale]/invite/[token] · the landing (Invitation-Telefon, Invitation-Desktop)", () => {
  it("greets the invitee by name and space, explains the role in the design's words, names the inviter, the days left and the single use", async () => {
    mocks.view = soren;
    const { container } = await open();
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("Hej Søren,");
    expect(heading).toHaveTextContent("du er inviteret til Almas rum.");
    expect(heading.textContent).toBe("Hej Søren, du er inviteret til Almas rum.");

    const lead = screen.getByTestId("invite-lead");
    expect(lead).toHaveTextContent("Jonas har inviteret dig som hjælper.");
    expect(within(lead).getByText("hjælper").tagName).toBe("STRONG");
    expect(lead).toHaveTextContent("Du kan logge måltider, godkende mad og se kurven.");

    // Under each layout's button, as both artboards draw it.
    expect(
      screen.getAllByText("Linket gælder i 6 dage endnu og kan kun bruges én gang."),
    ).toHaveLength(2);
    expect(screen.getByText("Frejsi", { selector: "[data-testid=wordmark]" })).toBeInTheDocument();
    // Kind reassurance, the inviter named as the one to ask again.
    expect(container.textContent).toContain(
      "Ny telefon senere? Så beder du Jonas eller en anden ejer om et nyt link.",
    );
    expect(container.textContent).toContain("Ingen adgangskode.");
    // The design's one footer line (docs/design/README.md "footers"), the same as the shell's,
    // and nothing about the token in the DOM.
    expect(container.textContent).toContain("Frejsi · åben kildekode · regner aldrig insulin");
    expect(container.textContent).not.toContain("erstatter ikke");
    expect(container.innerHTML).not.toContain(TOKEN);
  });

  it("has both layouts' copy: the phone lines and the desktop panel with its title and its button", async () => {
    mocks.view = soren;
    await open();
    const phone = screen.getByRole("button", { name: "Opret adgang med denne telefon" });
    expect(phone.closest(`.${pub.phoneOnly}`)).not.toBeNull();
    const panel = screen.getByRole("button", { name: "Opret adgang med denne computer" });
    expect(panel.closest(`.${pub.desktopOnly}`)).not.toBeNull();
    expect(panel.closest(`.${pub.phoneOnly}`)).toBeNull();
    expect(screen.getByText("Opret din adgang")).toBeInTheDocument();
    // The phone block is named by the shared title, not by a key borrowed from the desktop panel.
    expect(phone.closest("section")).toHaveAttribute("aria-label", "Opret din adgang");
    expect(
      screen.getByText(
        "Ingen adgangskode og ingen e-mail. Du logger ind med Windows Hello, Touch ID eller din telefon.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Vil du også bruge telefonen? Bed Jonas om et »tilføj enhed«-link bagefter.",
      ),
    ).toBeInTheDocument();
  });

  it("speaks English on /en and counts one day in the singular", async () => {
    mocks.view = { ...soren, daysLeft: 1 };
    await open("en");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Hi Søren, you're invited to Almas rum.",
    );
    expect(screen.getByTestId("invite-lead")).toHaveTextContent(
      "Jonas has invited you as a carer. You can log meals, verify food and see the curve.",
    );
    expect(
      screen.getAllByText("The link is valid for 1 more day and can be used only once."),
    ).toHaveLength(2);
    expect(
      await generateMetadata({ params: Promise.resolve({ locale: "en", token: TOKEN }) }),
    ).toEqual({ title: "Invitation" });
  });

  it("explains an owner and a viewer in the design's words (Personer-Desktop role cards)", async () => {
    mocks.view = { ...soren, role: "owner" };
    await open();
    expect(screen.getByTestId("invite-lead")).toHaveTextContent(
      "Jonas har inviteret dig som ejer. Du kan alt – også personer, enheder og indstillinger.",
    );
    cleanup();
    mocks.view = { ...soren, role: "viewer" };
    const { container } = await open();
    expect(screen.getByTestId("invite-lead")).toHaveTextContent(
      "Jonas har inviteret dig til at se med. Du kan se dagens måltider og kulhydrater. Blodsukker vises ikke.",
    );
    expect(container.textContent).not.toMatch(/mmol/);
  });

  it("reads differently for an add-a-device link: no role change, the existing user's own name", async () => {
    mocks.view = { ...soren, name: "Mette", role: "owner", forExistingUser: true };
    await open();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Hej Mette, du er ved at tilføje en enhed til Almas rum.",
    );
    expect(screen.getByTestId("invite-lead")).toHaveTextContent(
      "Jonas har sendt dig linket, så den her enhed også kan logge ind som dig. Du beholder din rolle i rummet.",
    );
    expect(screen.queryByText(/inviteret dig/)).toBeNull();
  });
});

describe("the button runs task 5's registration and lands signed in (§2b)", () => {
  // The landing points this device at the invitation's space and goes to the front page; the
  // index there lands on the role's home: Nu for a carer or owner, I dag for a viewer
  // ([locale]/page.test.tsx). So the destination and the shell always use the same membership.
  it("a carer: signs in, selects the invitation's space on this device, and hands over to the front page", async () => {
    mocks.view = soren;
    mocks.register.mockResolvedValue({ role: "carer", spaceId: "space-b" });
    mocks.switchSpace.mockResolvedValue(undefined);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Opret adgang med denne telefon" }));
    await waitFor(() => {
      expect(mocks.switchSpace).toHaveBeenCalledTimes(1);
    });
    expect(chosen()).toEqual({ locale: "da", spaceId: "space-b" });
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(mocks.register.mock.calls[0]?.[0]).toBe(TOKEN);
  });

  it("a viewer: the same hand-off, in the URL's locale; the index keeps a viewer off Now", async () => {
    mocks.view = { ...soren, role: "viewer" };
    mocks.register.mockResolvedValue({ role: "viewer", spaceId: "space-b" });
    mocks.switchSpace.mockResolvedValue(undefined);
    await open("en");
    fireEvent.click(screen.getByRole("button", { name: "Create access with this computer" }));
    await waitFor(() => {
      expect(chosen()).toEqual({ locale: "en", spaceId: "space-b" });
    });
  });

  it("an add-device link: the existing user's device is pointed at the space the link was for, not the shell's pick", async () => {
    mocks.view = { ...soren, name: "Mette", role: "owner", forExistingUser: true };
    mocks.register.mockResolvedValue({ role: "owner", spaceId: "space-b" });
    mocks.switchSpace.mockResolvedValue(undefined);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Opret adgang med denne telefon" }));
    await waitFor(() => {
      expect(chosen()).toEqual({ locale: "da", spaceId: "space-b" });
    });
  });

  it("a dismissed prompt says so kindly and stays on the page; the buttons are usable again", async () => {
    mocks.view = soren;
    mocks.register.mockRejectedValueOnce(new CeremonyError("cancelled"));
    await open();
    const button = screen.getByRole("button", { name: "Opret adgang med denne telefon" });
    fireEvent.click(button);
    expect(
      await screen.findByText("Det blev ikke til noget denne gang. Prøv igen, når du er klar."),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mocks.switchSpace).not.toHaveBeenCalled();
    expect(button).not.toBeDisabled();
  });

  it("a link that died since the page loaded shows the API's message by code; an unsupported browser its own", async () => {
    mocks.view = soren;
    mocks.register.mockRejectedValueOnce(new CeremonyError("api", "invite-used"));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Opret adgang med denne telefon" }));
    expect(
      await screen.findByText(
        "Invitationen er allerede brugt. Hvis det ikke var dig, så bed om en ny.",
      ),
    ).toBeInTheDocument();

    mocks.register.mockRejectedValueOnce(new CeremonyError("unsupported"));
    fireEvent.click(screen.getByRole("button", { name: "Opret adgang med denne telefon" }));
    expect(await screen.findByText(/kan ikke bruge adgangsnøgler/)).toBeInTheDocument();

    // Here, and only here, the way out of a failure that keeps happening is a new link.
    mocks.register.mockRejectedValueOnce(new CeremonyError("api", "forbidden"));
    fireEvent.click(screen.getByRole("button", { name: "Opret adgang med denne telefon" }));
    expect(
      await screen.findByText(
        "Det lykkedes ikke denne gang. Prøv igen – og hvis det bliver ved, så bed om et nyt link.",
      ),
    ).toBeInTheDocument();
  });

  it("an add-device link opened on a device that already holds the passkey says so, instead of asking to try again", async () => {
    mocks.view = { ...soren, name: "Mette", role: "owner", forExistingUser: true };
    mocks.register.mockRejectedValueOnce(new CeremonyError("already-registered"));
    await open();
    const button = screen.getByRole("button", { name: "Opret adgang med denne telefon" });
    fireEvent.click(button);
    expect(
      await screen.findByText(
        "Den her enhed kan allerede logge ind som dig. Så log ind i stedet, eller åbn linket på den telefon eller computer, du vil tilføje.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent(/Prøv igen/);
    // The line says to sign in instead, so the way to do that sits right next to it.
    expect(screen.getByRole("link", { name: "Log ind" })).toHaveAttribute("href", "/da/welcome");
    expect(mocks.switchSpace).not.toHaveBeenCalled();
    expect(button).not.toBeDisabled();
  });

  it("other failures offer no sign-in link: a new link or another try is the way out there", async () => {
    mocks.view = soren;
    mocks.register.mockRejectedValueOnce(new CeremonyError("cancelled"));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Opret adgang med denne telefon" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("link", { name: "Log ind" })).toBeNull();
  });

  it("registered but the space switch failed: the device is signed in, so it goes to the front page instead of reporting a failed registration", async () => {
    mocks.view = soren;
    mocks.register.mockResolvedValue({ role: "carer", spaceId: "space-b" });
    mocks.switchSpace.mockRejectedValueOnce(new Error("Failed to find Server Action"));
    await open("en");
    fireEvent.click(screen.getByRole("button", { name: "Create access with this phone" }));
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith("/en");
    });
    expect(mocks.register).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("an authenticator that refused for another reason gets the general line, not the cancelled one", async () => {
    mocks.view = soren;
    mocks.register.mockRejectedValueOnce(new CeremonyError("authenticator"));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Opret adgang med denne telefon" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Det lykkedes ikke denne gang/);
    expect(alert).not.toHaveTextContent(/når du er klar/);
  });
});

describe("a dead link (expired, used, revoked) · design gap 23", () => {
  const ttlDays = INVITE_TTL_MS / (24 * 60 * 60 * 1000);
  it.each([
    ["invite-expired", `Linket er udløbet. Et invitationslink gælder i ${ttlDays} dage.`],
    ["invite-used", "Linket er allerede brugt. Et invitationslink kan kun bruges én gang."],
    ["invite-revoked", "Linket er trukket tilbage af den, der sendte det."],
  ] as const)(
    "%s shows a kind page naming who can send a new one and reveals nothing of the space",
    async (code, body) => {
      mocks.error = new HttpError(410, code);
      const { container } = await open();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Det her link virker ikke længere",
      );
      expect(screen.getByText(body)).toBeInTheDocument();
      expect(container.textContent).toContain(
        "Den, der sendte dig linket – eller en anden ejer af rummet – kan sende dig et nyt.",
      );
      expect(screen.getByRole("link", { name: "Log ind" })).toHaveAttribute("href", "/da/welcome");
      expect(container.textContent).not.toContain("Alma");
      expect(container.textContent).not.toContain("Jonas");
      expect(container.textContent).not.toContain("Søren");
      expect(screen.queryByRole("button")).toBeNull();
      expect(container.textContent).toContain("Frejsi · åben kildekode · regner aldrig insulin");
    },
  );

  it("the expired line counts the days the auth core gives a link, in English too", async () => {
    mocks.error = new HttpError(410, "invite-expired");
    await open("en");
    expect(
      screen.getByText(`The link has expired. An invitation link is valid for ${ttlDays} days.`),
    ).toBeInTheDocument();
    expect(ttlDays).toBe(7);
  });

  it("an unknown token is the localized not-found page", async () => {
    mocks.error = new HttpError(404, "not-found");
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("any other failure is not swallowed into a kind page", async () => {
    mocks.error = new Error("database down");
    await expect(open()).rejects.toThrow("database down");
  });
});

describe("layout and theme (§6: 360 px and 1280 px, default accent, dark mode)", () => {
  const css = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

  it("switches from the phone layout to the desktop layout at 1280 px, as the shell does", () => {
    const sheet = css("public.module.css");
    expect(sheet).toMatch(/@media \(min-width: 1280px\)/);
    expect(sheet).toMatch(/\.phoneOnly\s*\{[^}]*display:\s*none/);
    expect(sheet).toMatch(/\.desktopOnly\s*\{[^}]*display:\s*none/);
  });

  it("uses tokens only, so dark mode and the accent come from tokens.css and no colour is hard-coded", () => {
    for (const file of ["public.module.css", "invite.module.css"]) {
      const sheet = css(file);
      expect(sheet, file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(sheet, file).not.toMatch(/rgba?\(/);
      expect(sheet, file).toMatch(/var\(--/);
    }
  });

  it("renders without a shell: no navigation, no tabs, no sidebar", async () => {
    mocks.view = soren;
    await open();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByTestId("phone-tabs")).toBeNull();
    expect(screen.queryByTestId("sidebar")).toBeNull();
  });
});
