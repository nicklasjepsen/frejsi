import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible, Newsreader } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import "@/styles/globals.css";

import { ServiceWorker } from "@/components/shell/ServiceWorker";
import { LOCALE_HEADER, resolveLocale } from "@/lib/i18n/routing";

// The two faces of "Kitchen table" (tokens.json#font): a serif for names and headings, a
// high-legibility sans for everything else. Self-hosted by next/font, so they load offline too.
const body = Atkinson_Hyperlegible({
  weight: ["400", "700"],
  subsets: ["latin", "latin-ext"],
  variable: "--font-body",
  display: "swap",
});
const display = Newsreader({
  weight: "variable",
  subsets: ["latin", "latin-ext"],
  axes: ["opsz"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Frejsi", template: "%s · Frejsi" },
  applicationName: "Frejsi",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Frejsi", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F1E8" },
    { media: "(prefers-color-scheme: dark)", color: "#1F1B17" },
  ],
};

/**
 * Fonts, theme and the document language. The locale comes from the middleware's request header;
 * the accent is set by the `(app)` layout on the shell (`data-accent`), since it belongs to the
 * signed-in user. Dark mode follows the system through CSS (tokens.css).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = resolveLocale((await headers()).get(LOCALE_HEADER));
  return (
    <html lang={locale} className={`${body.variable} ${display.variable}`}>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
