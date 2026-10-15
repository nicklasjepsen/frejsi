"use client";

import da from "../../messages/da.json";
import en from "../../messages/en.json";

import { stripLocale } from "@/lib/i18n/routing";

/**
 * The last resort when the root layout itself fails: no provider, no fonts, so the copy is read
 * straight from the message files in the locale of the URL. Nothing technical is shown; the error
 * is reported to App Insights by the server side (plan §9).
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const locale =
    typeof window === "undefined" ? null : stripLocale(window.location.pathname).locale;
  const messages = locale === "en" ? en : da;
  const copy = messages.errors.page;
  return (
    <html lang={locale ?? "da"}>
      <body
        style={{
          margin: 0,
          fontFamily: "system-ui, sans-serif",
          background: "#F6F1E8",
          color: "#2B2622",
        }}
      >
        <main style={{ maxWidth: 560, margin: "0 auto", padding: "80px 24px" }}>
          <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 600, fontSize: 28 }}>
            {copy.title}
          </h1>
          <p style={{ color: "#6E6458", lineHeight: 1.45 }}>{copy.body}</p>
          <p style={{ marginTop: 16 }}>
            <button
              type="button"
              onClick={reset}
              style={{
                minHeight: 44,
                padding: "0 18px",
                borderRadius: 14,
                border: 0,
                background: "#5A6A3B",
                color: "#F6F1E8",
                fontWeight: 700,
                fontSize: 15,
              }}
            >
              {copy.retry}
            </button>
          </p>
        </main>
      </body>
    </html>
  );
}
