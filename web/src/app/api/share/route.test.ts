// @vitest-environment node
import type { EventSink } from "@frejsi/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cookieStoreFor,
  seedSpace,
  SESSIONS,
  T0,
  USERS,
  type Who,
} from "@/components/settings/route-test-support";
import { FakeAuthDb } from "@/lib/auth/test-support";
import { shareStore } from "@/lib/recipes/share-store";
import plate from "../spaces/[spaceId]/estimates/fixtures/plate.json";
import { POST } from "./route";
import { GET } from "./[shareId]/route";

const shared = vi.hoisted(() => {
  const holder: { db: Record<string, unknown>; request: Request | null; lines: string[] } = {
    db: {},
    request: null,
    lines: [],
  };
  const sink: EventSink = { publish: () => Promise.resolve() };
  return { holder, prisma: new Proxy({}, { get: (_target, key: string) => holder.db[key] }), sink };
});
vi.mock("@frejsi/shared", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const log = {
    info: (msg: string, fields: unknown) =>
      shared.holder.lines.push(JSON.stringify({ msg, fields })),
    warn: (msg: string, fields: unknown) =>
      shared.holder.lines.push(JSON.stringify({ msg, fields })),
    error: (msg: string, fields: unknown) =>
      shared.holder.lines.push(JSON.stringify({ msg, fields })),
    raw: (line: string) => shared.holder.lines.push(line),
  };
  return { ...original, prisma: shared.prisma, createEventSinkFromEnv: () => shared.sink, log };
});
vi.mock("next/headers", () => ({ cookies: cookieStoreFor(() => shared.holder.request) }));

let fake: FakeAuthDb;
beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  fake = new FakeAuthDb(() => T0);
  seedSpace(fake);
  shared.holder.db = fake.db as unknown as Record<string, unknown>;
  shared.holder.lines = [];
});
afterEach(() => {
  vi.useRealTimers();
});

function post(fields: Record<string, string | Blob>, as: Who | null = "carer") {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields))
    if (value instanceof Blob) form.append(key, value, "recipe.jpg");
    else form.append(key, value);
  const headers: Record<string, string> = {};
  if (as !== null) headers.cookie = `frejsi_session=${SESSIONS[as]}`;
  const req = new Request("https://frejsi.example/api/share", {
    method: "POST",
    headers,
    body: form,
  });
  shared.holder.request = req;
  return POST(req);
}
function take(id: string, as: Who | null = "carer") {
  const headers: Record<string, string> = {};
  if (as !== null) headers.cookie = `frejsi_session=${SESSIONS[as]}`;
  const req = new Request(`https://frejsi.example/api/share/${id}`, { headers });
  shared.holder.request = req;
  return GET(req, { params: Promise.resolve({ shareId: id }) });
}
const shareId = (response: Response) =>
  new URL(response.headers.get("location") ?? "", "https://frejsi.example").searchParams.get(
    "share",
  ) ?? "";
const jpeg = () => {
  const base64 = plate.photoDataUrl.split(",")[1] ?? "";
  return new Blob([Buffer.from(base64, "base64")], { type: "image/jpeg" });
};

describe("POST /api/share (the Web Share Target receiver)", () => {
  it("stores a title, text and URL for the session and redirects to the form in the person's locale", async () => {
    const response = await post({
      title: "Fictional lasagne",
      text: "500 g mince",
      url: "https://recipes.example/lasagne",
    });
    expect(response.status).toBe(303);
    const location = response.headers.get("location") ?? "";
    expect(location).toMatch(/^https:\/\/frejsi\.example\/da\/recipe\/new\?share=[0-9a-f-]{36}$/);
    const id = shareId(response);
    const taken = await take(id);
    expect(taken.status).toBe(200);
    expect(await taken.json()).toEqual({
      title: "Fictional lasagne",
      text: "500 g mince",
      url: "https://recipes.example/lasagne",
    });
    const again = await take(id);
    expect(again.status).toBe(410);
    expect(await again.json()).toMatchObject({ error: { code: "share-expired" } });
  });
  it("binds the share to the session that posted it and forgets it after ten minutes", async () => {
    const id = shareId(await post({ text: "a shared note" }));
    expect((await take(id, "owner")).status).toBe(410);
    expect((await take(id, null)).status).toBe(403);
    vi.setSystemTime(new Date(T0.getTime() + 10 * 60 * 1000));
    expect((await take(id)).status).toBe(410);
  });
  it("takes a URL that arrived in the text field, and a shared image as a JPEG data URL", async () => {
    const linkOnly = shareId(await post({ text: "https://recipes.example/boller" }));
    expect(await (await take(linkOnly)).json()).toEqual({
      text: "https://recipes.example/boller",
      url: "https://recipes.example/boller",
    });
    const withImage = shareId(await post({ files: jpeg() }));
    const share = (await (await take(withImage)).json()) as { photoDataUrl?: string };
    expect(share.photoDataUrl).toMatch(/^data:image\/jpeg;base64,\/9j\//);
    const sizeBefore = shareStore().size;
    expect((await post({ files: new Blob(["%PDF"], { type: "application/pdf" }) })).status).toBe(
      400,
    );
    expect((await post({})).status).toBe(400);
    expect((await post({ url: "http://recipes.example/plain" })).status).toBe(400);
    expect(shareStore().size).toBe(sizeBefore);
  });
  it("sends a signed-out share to welcome and keeps nothing; a simpleMode session goes to Nu", async () => {
    const before = shareStore().size;
    const response = await post({ text: "500 g mince", url: "https://recipes.example/x" }, null);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://frejsi.example/da/welcome");
    expect(shareStore().size).toBe(before);
    Object.assign(fake.rows("user").find((u) => u.id === USERS.carer) ?? {}, { simpleMode: true });
    const simple = await post({ text: "500 g mince" });
    expect(simple.headers.get("location")).toBe("https://frejsi.example/da/now");
    expect(shareStore().size).toBe(before);
  });
  it("logs the outcome only: never the title, the text, the URL or the image", async () => {
    await post({
      title: "Secret title",
      text: "secret text",
      url: "https://recipes.example/secret",
      files: jpeg(),
    });
    const log = shared.holder.lines.join("\n");
    expect(log).toContain("share.received");
    expect(log).not.toMatch(/Secret title|secret text|recipes\.example|\/9j\//);
    const base64 = plate.photoDataUrl.split(",")[1] ?? "";
    expect(log).not.toContain(base64.slice(0, 40));
  });
});
