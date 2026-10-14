import type { ReactNode } from "react";

// Placeholder root layout so that `next build` has an app directory. The shell lane (task 3)
// replaces it with fonts, theme, accent and the [locale] routing.
export const metadata = { title: "Frejsi" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="da">
      <body>{children}</body>
    </html>
  );
}
