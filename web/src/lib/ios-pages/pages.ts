import { APP_NAME } from "@/lib/brand";
import { LOCALES, negotiateLocale, type AppLocale } from "@/lib/i18n/routing";

import da from "./messages/da.json";
import en from "./messages/en.json";

/**
 * The public pages the iPhone app links to (plan 2026-11-08-ios-follower-app §3, §5, §6): `/follow`,
 * `/privacy` and `/support`. They are plain HTML from route handlers, outside the app's layouts, so
 * no script, font loader, service worker or telemetry runs on them; the Content-Security-Policy
 * below forbids scripts outright. That matters most for `/follow`: its URL fragment carries a
 * Nightscout token, and nothing here may read it. The copy lives beside this file, not in
 * web/messages, because the app's provider sends every web/messages namespace to every page.
 */
export type IosPageCopy = typeof da;
const COPY: Record<AppLocale, IosPageCopy> = { da, en };

/** The app's Apple ID in App Store Connect. */
export const APP_STORE_ID = "6832337396";
/** The App Store page. It answers once the app is approved and released (plan §6). */
export const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;
/** Where support and privacy questions go. A placeholder the owner confirms before launch. */
export const SUPPORT_EMAIL = "naensom@jepsen.ninja";
export const SOURCE_URL = "https://github.com/nicklasjepsen/naensom";

/** No script may run, nothing may be loaded from elsewhere, and the page cannot be framed. */
export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function iosPageCopy(locale: AppLocale): IosPageCopy {
  return COPY[locale];
}

/** `?lang=` when it names one of ours, else the browser's language, else English for strangers. */
export function iosPageLocale(lang: string | null, acceptLanguage: string | null): AppLocale {
  if (lang === "da" || lang === "en") return lang;
  return negotiateLocale(acceptLanguage) ?? "en";
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const link = (href: string, text: string) =>
  `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;

/** Escapes a message, then fills its `{name}` slots with ready-made HTML. */
function fill(text: string, slots: Record<string, string>): string {
  return escapeHtml(text).replace(/\{(\w+)\}/g, (whole, name: string) => slots[name] ?? whole);
}

/**
 * The data controller named on `/privacy`: the deployment's `PRIVACY_CONTROLLER` setting (a name and
 * country, set as a repository variable, never committed), or a plain description without it.
 */
export function privacyController(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const value = env.PRIVACY_CONTROLLER?.trim();
  return value === undefined || value === "" ? null : value;
}

function slotsFor(copy: IosPageCopy, controller: string | null): Record<string, string> {
  return {
    email: link(`mailto:${SUPPORT_EMAIL}`, SUPPORT_EMAIL),
    source: link(SOURCE_URL, "GitHub"),
    controller: escapeHtml(controller ?? copy.common.controllerFallback),
  };
}

const STYLE = `
:root{color-scheme:light dark;--ground:#f6f1e8;--surface:#fffcf6;--text:#2b2622;--muted:#6e6458;--hairline:#e7dfd0;--accent:#5a6a3b;--accent-on:#f6f1e8}
@media (prefers-color-scheme:dark){:root{--ground:#1f1b17;--surface:#2a2521;--text:#f1eadf;--muted:#b5aa9a;--hairline:#3a332c;--accent:#9dae78;--accent-on:#1f1b17}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--text);font:17px/1.55 "Atkinson Hyperlegible",system-ui,-apple-system,sans-serif}
main{max-width:40rem;margin:0 auto;padding:24px 16px 48px}
header{display:flex;justify-content:space-between;align-items:baseline;gap:16px;margin-bottom:24px}
.brand{font:600 22px/1.2 Newsreader,Georgia,serif;color:var(--text);text-decoration:none}
h1{font:600 30px/1.2 Newsreader,Georgia,serif;margin:0 0 16px}
h2{font:600 21px/1.3 Newsreader,Georgia,serif;margin:32px 0 8px}
p,ul,ol{margin:0 0 12px}
li{margin-bottom:6px}
a{color:var(--accent)}
.card{background:var(--surface);border:1px solid var(--hairline);border-radius:20px;padding:20px;margin:0 0 24px}
.button{display:inline-block;background:var(--accent);color:var(--accent-on);border-radius:14px;padding:12px 20px;font-weight:700;text-decoration:none;margin:4px 0 12px}
.muted{color:var(--muted);font-size:15px}
footer{border-top:1px solid var(--hairline);margin-top:40px;padding-top:16px;color:var(--muted);font-size:15px}
footer a{margin-right:16px}
`;

function documentHtml(
  lang: AppLocale,
  title: string,
  header: string,
  body: string,
  footer: string,
  head = "",
) {
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · ${escapeHtml(APP_NAME)}</title>
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">${head}
<style>${STYLE}</style>
</head>
<body>
<main>
<header><span class="brand">${escapeHtml(APP_NAME)}</span>${header}</header>
${body}
<footer>${footer}</footer>
</main>
</body>
</html>
`;
}

function footerLinks(copy: IosPageCopy, lang: AppLocale): string {
  return [
    link(`/privacy?lang=${lang}`, copy.common.privacyLink),
    link(`/support?lang=${lang}`, copy.common.supportLink),
    link(SOURCE_URL, copy.common.sourceLink),
  ].join("");
}

/**
 * `/follow`: shown only when the app is missing (with the app, iOS opens the link in it). Both
 * languages on one static page, so it needs nothing from the request.
 */
export function followPage(): string {
  const part = (lang: AppLocale) => {
    const { follow } = COPY[lang];
    return `<section class="card" lang="${lang}">
<h1>${escapeHtml(follow.title)}</h1>
<p>${escapeHtml(follow.lead)}</p>
<ol>${follow.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
<a class="button" href="${escapeHtml(APP_STORE_URL)}">${escapeHtml(follow.appStore)}</a>
<p>${escapeHtml(follow.haveApp)}</p>
<p class="muted">${escapeHtml(follow.private)}</p>
<p class="muted">${escapeHtml(follow.iphoneOnly)}</p>
</section>`;
  };
  const body = part("da") + part("en");
  // Safari's Smart App Banner: on an iPhone without the app, Safari offers it from the App Store
  // above the page. It is a meta tag, so the no-script policy is untouched.
  const banner = `\n<meta name="apple-itunes-app" content="app-id=${APP_STORE_ID}">`;
  return documentHtml("da", COPY.da.follow.pageTitle, "", body, footerLinks(COPY.da, "da"), banner);
}

/** `/privacy` and `/support`, in one language with a link to the other. */
export function textPage(
  kind: "privacy" | "support",
  lang: AppLocale,
  controller: string | null = null,
): string {
  const copy = COPY[lang];
  const page = copy[kind];
  const slots = slotsFor(copy, controller);
  const other = LOCALES.find((locale) => locale !== lang) ?? lang;
  const switcher = `<a href="/${kind}?lang=${other}" hreflang="${other}" lang="${other}">${escapeHtml(copy.common.otherLanguage)}</a>`;
  const sections = page.sections
    .map((section) => {
      const paragraphs = section.body.map((p) => `<p>${fill(p, slots)}</p>`).join("");
      const list =
        section.list.length === 0
          ? ""
          : `<ul>${section.list.map((item) => `<li>${fill(item, slots)}</li>`).join("")}</ul>`;
      return `<h2>${escapeHtml(section.heading)}</h2>${paragraphs}${list}`;
    })
    .join("\n");
  const body = `<h1>${escapeHtml(page.title)}</h1>
${page.intro.map((p) => `<p>${fill(p, slots)}</p>`).join("")}
${sections}
<p class="muted">${escapeHtml(copy.common.updated)}</p>`;
  return documentHtml(lang, page.pageTitle, switcher, body, footerLinks(copy, lang));
}

/** The headers every one of these pages answers with. */
export function pageHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=3600",
    ...extra,
  });
}
