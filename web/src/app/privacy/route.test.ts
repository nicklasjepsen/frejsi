// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { iosPageCopy } from "@/lib/ios-pages/pages";

import { GET as privacy, dynamic } from "./route";
import { GET as support } from "../support/route";

const request = (path: string, acceptLanguage?: string) =>
  new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: acceptLanguage ? { "accept-language": acceptLanguage } : {},
  });

describe("GET /privacy and /support", () => {
  it("answer in the browser's language, and in the one ?lang= names", async () => {
    expect(dynamic).toBe("force-dynamic");
    const da = privacy(request("/privacy", "da-DK,da;q=0.9,en;q=0.8"));
    expect(da.status).toBe(200);
    expect(da.headers.get("content-language")).toBe("da");
    expect(da.headers.get("vary")).toBe("Accept-Language");
    expect(await da.text()).toContain(iosPageCopy("da").privacy.title);

    const en = privacy(request("/privacy?lang=en", "da"));
    expect(en.headers.get("content-language")).toBe("en");
    expect(await en.text()).toContain(iosPageCopy("en").privacy.title);

    const help = support(request("/support", "en-US"));
    expect(help.status).toBe(200);
    expect(help.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await help.text()).toContain(iosPageCopy("en").support.title);
    const hjaelp = support(request("/support?lang=da"));
    expect(await hjaelp.text()).toContain(iosPageCopy("da").support.title);
  });
});
