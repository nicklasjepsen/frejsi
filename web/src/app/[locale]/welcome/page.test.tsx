import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import type { SessionContext } from "@frejsi/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { CeremonyError } from "../invite/passkey-client";

const mocks = vi.hoisted(() => ({
  session: null as SessionContext | null,
  signIn: vi.fn(),
  navigate: vi.fn<(href: string) => void>(),
}));
vi.mock("@/components/shell/shell-session", () => ({
  getShellSession: () => Promise.resolve(mocks.session),
}));
vi.mock("../invite/passkey-client", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  signInWithPasskey: () => mocks.signIn() as Promise<unknown>,
}));
vi.mock("../invite/navigate", () => ({
  navigate: (href: string) => {
    mocks.navigate(href);
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  },
}));

import WelcomePage, { generateMetadata } from "./page";

async function open(locale: AppLocale = "da") {
  const ui = (await WelcomePage({ params: Promise.resolve({ locale }) })) as ReactElement;
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)}>
      {ui}
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.session = null;
  mocks.signIn.mockReset();
  mocks.navigate.mockReset();
});

describe("/[locale]/welcome · the returning sign-in (plan §6, design gap 23)", () => {
  it("is reachable without a session: offers Log ind and, below it, that a first visit needs an invitation link", async () => {
    const { container } = await open();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Velkommen tilbage");
    expect(screen.getByText("Frejsi", { selector: "[data-testid=wordmark]" })).toBeInTheDocument();
    const login = screen.getByRole("button", { name: "Log ind" });
    const firstTime = screen.getByText("Første gang her?");
    expect(firstTime).toBeInTheDocument();
    expect(login.compareDocumentPosition(firstTime) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).toContain(
      "Så skal du have et invitationslink fra en ejer af rummet.",
    );
    expect(container.textContent).toContain("Frejsi · åben kildekode · regner aldrig insulin");
    expect(container.textContent).not.toContain("erstatter ikke");
    // No shell: no navigation, no tabs, no sidebar, and no field for a name or a password.
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByTestId("phone-tabs")).toBeNull();
    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("speaks English on /en and titles the tab", async () => {
    await open("en");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Welcome back");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("First time here?")).toBeInTheDocument();
    expect(await generateMetadata({ params: Promise.resolve({ locale: "en" }) })).toEqual({
      title: "Welcome",
    });
    expect(await generateMetadata({ params: Promise.resolve({ locale: "da" }) })).toEqual({
      title: "Velkommen",
    });
  });

  it("sends a signed-in visitor to the front page, which lands on their home", async () => {
    mocks.session = {
      userId: "u1",
      name: "Jonas",
      simpleMode: false,
      accent: "olive",
      locale: "da",
      memberships: [{ spaceId: "s1", role: "owner" }],
    };
    await expect(open("en")).rejects.toThrow("NEXT_REDIRECT:/en");
  });
});

describe("Log ind runs task 5's sign-in and lands on Now (§2b)", () => {
  it("navigates to the locale's front page after a verified passkey; the index picks Nu or the viewer's day by role", async () => {
    mocks.signIn.mockResolvedValue({ userId: "u1" });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Log ind" }));
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith("/da");
    });
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
  });

  it("says, kindly, that an unknown passkey is probably a new device and that an owner can help", async () => {
    mocks.signIn.mockRejectedValueOnce(new CeremonyError("api", "forbidden"));
    await open();
    const button = screen.getByRole("button", { name: "Log ind" });
    fireEvent.click(button);
    expect(
      await screen.findByText(
        "Vi kender ikke den adgangsnøgle. Er det en ny telefon eller computer? Så bed en ejer af rummet om et »tilføj enhed«-link.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(button).not.toBeDisabled();
  });

  it("a dismissed prompt, an unsupported browser and any other failure each get their own line", async () => {
    mocks.signIn.mockRejectedValueOnce(new CeremonyError("cancelled"));
    await open();
    const button = screen.getByRole("button", { name: "Log ind" });
    fireEvent.click(button);
    expect(await screen.findByText(/Det blev ikke til noget denne gang/)).toBeInTheDocument();

    mocks.signIn.mockRejectedValueOnce(new CeremonyError("unsupported"));
    fireEvent.click(button);
    expect(await screen.findByText(/kan ikke bruge adgangsnøgler/)).toBeInTheDocument();

    mocks.signIn.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(button);
    expect(
      await screen.findByText("Det lykkedes ikke denne gang. Prøv igen om et øjeblik."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    // A returning user is never sent to ask for a link: that only makes sense on an invitation.
    expect(screen.getByRole("alert")).not.toHaveTextContent(/link/);

    // An authenticator that refused (rpId, unsupported algorithm) is not a cancellation.
    mocks.signIn.mockRejectedValueOnce(new CeremonyError("authenticator"));
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Det lykkedes ikke denne gang/);
    });
    expect(screen.getByRole("alert")).not.toHaveTextContent(/når du er klar/);
  });

  it("disables the button and shows Et øjeblik while the prompt is open", async () => {
    let finish: (value: { userId: string }) => void = () => undefined;
    mocks.signIn.mockReturnValueOnce(
      new Promise<{ userId: string }>((resolve) => {
        finish = resolve;
      }),
    );
    await open();
    const button = screen.getByRole("button", { name: "Log ind" });
    fireEvent.click(button);
    expect(await screen.findByRole("status")).toHaveTextContent("Et øjeblik");
    expect(button).toBeDisabled();
    finish({ userId: "u1" });
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith("/da");
    });
  });
});

describe("layout and theme (§6)", () => {
  it("uses tokens only, so dark mode and the default accent come from tokens.css", () => {
    const sheet = readFileSync(path.resolve(import.meta.dirname, "welcome.module.css"), "utf8");
    expect(sheet).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(sheet).not.toMatch(/rgba?\(/);
    expect(sheet).toMatch(/var\(--/);
    expect(sheet).toMatch(/@media \(min-width: 1280px\)/);
  });
});
