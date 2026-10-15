import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const publicDir = path.resolve(import.meta.dirname, "../../../public");
const read = (file: string) => readFileSync(path.join(publicDir, file), "utf8");

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
}

describe("manifest.webmanifest (plan §6)", () => {
  const manifest = JSON.parse(read("manifest.webmanifest")) as Manifest;

  it("has a name, display standalone and a start_url", () => {
    expect(manifest.name).toBe("Frejsi");
    expect(manifest.short_name).toBe("Frejsi");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
  });

  it("lists 192 and 512 px icons that exist, one of them maskable", () => {
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) {
      expect(icon.src.startsWith("/")).toBe(true);
      expect(existsSync(path.join(publicDir, icon.src)), icon.src).toBe(true);
      expect(icon.type).toBe("image/png");
    }
  });
});

describe("sw.js (the offline shell)", () => {
  const sw = read("sw.js");
  const match = /const PRECACHE = (\[[^\]]*\])/.exec(sw);
  const precache = JSON.parse(match?.[1] ?? "[]") as string[];

  it("precaches the shell routes in both locales, the manifest, the icons and the offline page", () => {
    for (const route of ["/da", "/en", "/da/now", "/en/now", "/da/welcome", "/en/welcome"]) {
      expect(precache).toContain(route);
    }
    expect(precache).toContain("/manifest.webmanifest");
    expect(precache).toContain("/icons/icon-192.png");
    expect(precache).toContain("/icons/icon-512.png");
    expect(precache).toContain("/offline.html");
    expect(existsSync(path.join(publicDir, "offline.html"))).toBe(true);
  });

  it("never caches the API, so a glucose value is never served from a cache", () => {
    expect(sw).toContain('"/api/"');
    expect(precache.some((route) => route.startsWith("/api"))).toBe(false);
  });
});
