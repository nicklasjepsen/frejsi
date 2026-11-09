// @vitest-environment node
import { describe, expect, it } from "vitest";

import { LOCALES } from "@/lib/i18n/routing";

import {
  APP_STORE_URL,
  CONTENT_SECURITY_POLICY,
  SUPPORT_EMAIL,
  escapeHtml,
  followPage,
  iosPageCopy,
  iosPageLocale,
  pageHeaders,
  privacyController,
  textPage,
} from "./pages";

function keysOf(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix];
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, child]) =>
      keysOf(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  throw new Error(`Unexpected value at ${prefix}`);
}

const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : typeof value === "object" && value !== null
      ? Object.values(value).flatMap(strings)
      : [];

const DANISH = /[æøåÆØÅ]/;

describe("the iPhone app's pages: copy", () => {
  it("has the same keys, lists and list lengths in da and en", () => {
    const da = keysOf(iosPageCopy("da")).sort();
    expect(da.length).toBeGreaterThan(50);
    expect(keysOf(iosPageCopy("en")).sort()).toEqual(da);
  });

  it("writes every string in both locales, none empty", () => {
    for (const locale of LOCALES) {
      for (const text of strings(iosPageCopy(locale))) expect(text.trim()).not.toBe("");
    }
  });

  it("speaks Danish in da and English in en (names and the language switch aside)", () => {
    const da = iosPageCopy("da");
    expect(da.privacy.title).toMatch(DANISH);
    const en = iosPageCopy("en");
    const english = strings({ ...en, common: { ...en.common, otherLanguage: "" } })
      .map((text) => text.replaceAll("Nænsom", "").replace("Datatilsynet", ""))
      .filter((text) => DANISH.test(text));
    expect(english).toEqual([]);
  });

  it("names no glucose value and no unit on any page", () => {
    for (const locale of LOCALES) {
      for (const text of strings(iosPageCopy(locale))) {
        expect(text, text).not.toMatch(/mmol|mg\/dl/i);
      }
    }
  });

  it("covers what the relay stores and how it goes away (plan §4, §5)", () => {
    const privacy = strings(iosPageCopy("en").privacy).join("\n");
    for (const fact of [
      "Azure Key Vault",
      "host name",
      "push tokens",
      "four colour thresholds",
      "the time only, not the value",
      "no readings and no history",
      "IP address",
      "West Europe",
      "Sweden Central",
      "Remove this phone",
      "30 days",
      "7 days",
      "no analytics",
      "not a medical device",
      "Keep the CGM app and its alarms",
      "{email}",
    ]) {
      expect(privacy, fact).toContain(fact);
    }
    const support = strings(iosPageCopy("en").support).join("\n");
    for (const fact of [
      "link",
      "QR code",
      "Test connection",
      "Try the demo",
      "Keep the CGM app and its alarms",
      "{email}",
    ]) {
      expect(support, fact).toContain(fact);
    }
  });
});

describe("the iPhone app's pages: HTML", () => {
  it("/follow shows both languages, the App Store link and runs nothing", () => {
    const html = followPage();
    expect(html).toContain('lang="da"');
    expect(html).toContain('lang="en"');
    expect(html).toContain(escapeHtml(iosPageCopy("da").follow.title));
    expect(html).toContain(escapeHtml(iosPageCopy("en").follow.title));
    expect(html).toContain(`href="${APP_STORE_URL}"`);
    expect(APP_STORE_URL).toBe("https://apps.apple.com/app/id6832337396");
    expect(html).toContain('<meta name="apple-itunes-app" content="app-id=6832337396">');
    // The fragment carries a token: no script, no handler, nothing that reads the location.
    expect(html).not.toMatch(/<script|<iframe|<form|<img|\bon[a-z]+=|location|hash|javascript:/i);
  });

  it.each(LOCALES)(
    "/privacy and /support in %s: title, sections, contact, switch, no script",
    (lang) => {
      for (const kind of ["privacy", "support"] as const) {
        const html = textPage(kind, lang);
        const page = iosPageCopy(lang)[kind];
        expect(html).toContain(`<html lang="${lang}">`);
        expect(html).toContain(`<h1>${escapeHtml(page.title)}</h1>`);
        for (const section of page.sections) {
          expect(html).toContain(`<h2>${escapeHtml(section.heading)}</h2>`);
        }
        expect(html).toContain(`<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`);
        expect(html).not.toContain("{email}");
        expect(html).toContain(`href="/${kind}?lang=${lang === "da" ? "en" : "da"}"`);
        expect(html).not.toMatch(/<script|\bon[a-z]+=|javascript:/i);
      }
    },
  );

  it("names the data controller only from the deployment's setting, never from the repo", () => {
    expect(privacyController({})).toBeNull();
    expect(privacyController({ PRIVACY_CONTROLLER: "  " })).toBeNull();
    expect(privacyController({ PRIVACY_CONTROLLER: " A. Person, Denmark " })).toBe(
      "A. Person, Denmark",
    );
    for (const lang of LOCALES) {
      const unnamed = textPage("privacy", lang);
      expect(unnamed).toContain(escapeHtml(iosPageCopy(lang).common.controllerFallback));
      expect(unnamed).not.toContain("{controller}");
      const named = textPage("privacy", lang, "A. Person <Denmark>");
      expect(named).toContain("A. Person &lt;Denmark&gt;");
      expect(named).not.toContain(escapeHtml(iosPageCopy(lang).common.controllerFallback));
    }
  });

  it("escapes copy", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });

  it("answers with a policy that forbids scripts and sends no referrer", () => {
    const headers = pageHeaders();
    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(CONTENT_SECURITY_POLICY).not.toContain("script-src");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
  });
});

describe("iosPageLocale", () => {
  it("takes ?lang first, then the browser's language, then English", () => {
    expect(iosPageLocale("da", "en-GB")).toBe("da");
    expect(iosPageLocale("en", "da")).toBe("en");
    expect(iosPageLocale("xx", "da-DK,da;q=0.9")).toBe("da");
    expect(iosPageLocale(null, "en-US")).toBe("en");
    expect(iosPageLocale(null, "de-DE")).toBe("en");
    expect(iosPageLocale(null, null)).toBe("en");
  });
});
