import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/lib/i18n/Provider";
import { getMessages } from "@/lib/i18n/messages";
import type { AppLocale } from "@/lib/i18n/routing";

import { ImportScreen } from "./ImportScreen";
import { settingsApi } from "./settings-client";

const navigation = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/da/settings/import",
}));

const fixture = readFileSync(
  path.resolve(import.meta.dirname, "../../../../fixtures/clarity/clarity-export-mmol.csv"),
  "utf8",
);

const RESULT = {
  format: "clarity",
  readings: {
    added: 10,
    skipped: 0,
    from: "2026-10-14T05:00:12.000Z",
    to: "2026-10-14T05:45:12.000Z",
  },
  meals: { added: 2, skipped: 0 },
  otherRows: 13,
};

function fakeApi(answer: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return Promise.resolve(answer());
  });
  return { api: settingsApi(fetchImpl as unknown as typeof fetch), calls };
}

function mount(api: ReturnType<typeof settingsApi>, locale: AppLocale = "da") {
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)} timeZone="Europe/Copenhagen">
      <ImportScreen locale={locale} spaceId="s1" timezone="Europe/Copenhagen" api={api} />
    </I18nProvider>,
  );
}

/** jsdom's File has no text(); the screen only needs that one method. */
function csvFile(text: string): File {
  const file = new File([text], "clarity.csv", { type: "text/csv" });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
  return file;
}

function choose(text = fixture) {
  fireEvent.change(screen.getByLabelText("Fil fra Dexcom Clarity"), {
    target: { files: [csvFile(text)] },
  });
}

beforeEach(() => {
  navigation.refresh.mockClear();
});
afterEach(cleanup);

describe("ImportScreen (#154)", () => {
  it("names the format from its message, explains what comes along, and posts the file as text", async () => {
    const { api, calls } = fakeApi(() => Response.json(RESULT));
    mount(api);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Importér fra Dexcom Clarity",
    );
    expect(screen.getByText(/Alt andet i filen springes over og gemmes ikke/)).toBeInTheDocument();
    expect(screen.getByText("Tiderne i filen læses som Europe/Copenhagen.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importér" })).toBeDisabled();
    choose();
    expect(screen.getByRole("button", { name: "Importér" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Importér" }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.url).toBe("/api/spaces/s1/import");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      text: fixture,
      createMeals: true,
    });
  });

  it("hides the native file input behind a labelled button and names the chosen file", () => {
    const { api } = fakeApi(() => Response.json(RESULT));
    mount(api);
    const input = screen.getByLabelText("Fil fra Dexcom Clarity");
    expect(input).toHaveAttribute("type", "file");
    expect(input.className).toMatch(/srOnly/);
    expect(screen.getByText("Vælg fil")).toBeInTheDocument();
    expect(screen.getByTestId("file-name")).toHaveTextContent("Ingen fil valgt endnu");
    choose();
    expect(screen.getByTestId("file-name")).toHaveTextContent("clarity.csv");
    expect(screen.getByRole("checkbox", { name: /Opret måltider/ })).toBeChecked();
    cleanup();
    mount(api, "en");
    expect(screen.getByText("Choose a file")).toBeInTheDocument();
    expect(screen.getByTestId("file-name")).toHaveTextContent("No file chosen yet");
  });

  it("shows the counts it was answered and refreshes, never a row of the file", async () => {
    const { api } = fakeApi(() => Response.json(RESULT));
    const { container } = mount(api);
    choose();
    fireEvent.click(screen.getByRole("button", { name: "Importér" }));
    const result = await screen.findByTestId("import-result");
    expect(result).toHaveTextContent("10 nye målinger · ingen fandtes i forvejen");
    expect(result).toHaveTextContent(
      /Fra 14\.? okt\.? 2026,? 07\.00 til 14\.? okt\.? 2026,? 07\.45/,
    );
    expect(result).toHaveTextContent("2 nye måltider · ingen sprunget over");
    expect(result).toHaveTextContent("13 andre rækker i filen blev sprunget over og er ikke gemt.");
    expect(result).toHaveTextContent("Du kan roligt importere den samme fil igen");
    expect(navigation.refresh).toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/EGV|Alma|insulin/i);
  });

  it("sends createMeals false when the switch is off, and words a run that added nothing", async () => {
    const { api, calls } = fakeApi(() =>
      Response.json({
        ...RESULT,
        readings: { ...RESULT.readings, added: 0, skipped: 10 },
        meals: { added: 0, skipped: 2 },
      }),
    );
    mount(api);
    choose();
    fireEvent.click(screen.getByLabelText("Opret måltider af kulhydraterne i filen"));
    fireEvent.click(screen.getByRole("button", { name: "Importér" }));
    const result = await screen.findByTestId("import-result");
    expect(JSON.parse(calls[0]?.init.body as string)).toMatchObject({ createMeals: false });
    expect(result).toHaveTextContent("Ingen nye målinger · 10 fandtes i forvejen");
    expect(result).toHaveTextContent("Ingen nye måltider · 2 sprunget over");
  });

  it("shows the translated refusal and keeps the form", async () => {
    const { api } = fakeApi(() =>
      Response.json({ error: { code: "import-unrecognised", message: "" } }, { status: 400 }),
    );
    mount(api);
    choose("name,carbs\n");
    fireEvent.click(screen.getByRole("button", { name: "Importér" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Det ligner ikke en eksportfil, Frejsi kender.",
    );
    expect(screen.queryByTestId("import-result")).toBeNull();
    expect(screen.getByRole("button", { name: "Importér" })).toBeEnabled();
  });

  it("reads the same in English", () => {
    const { api } = fakeApi(() => Response.json(RESULT));
    mount(api, "en");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Import from Dexcom Clarity",
    );
    expect(screen.getByLabelText("Create meals from the carbs in the file")).toBeChecked();
  });
});
