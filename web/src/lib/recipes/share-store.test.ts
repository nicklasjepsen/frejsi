import { describe, expect, it } from "vitest";
import { SHARE_LIMIT, SHARE_TTL_MS, ShareStore } from "./share-store";

describe("ShareStore (ten minutes, one session, one take)", () => {
  it("hands a share out once to the session that posted it and never to another", () => {
    const store = new ShareStore(() => 1000);
    const id = store.put("sess-a", { text: "500 g flour" });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.take(id, "sess-b")).toBeNull();
    expect(store.take(id, "sess-a")).toEqual({ text: "500 g flour" });
    expect(store.take(id, "sess-a")).toBeNull();
  });
  it("forgets a share after ten minutes and keeps at most the newest entries", () => {
    let now = 0;
    const store = new ShareStore(() => now);
    const id = store.put("sess-a", { url: "https://recipes.example/x" });
    now = SHARE_TTL_MS - 1;
    expect(store.size).toBe(1);
    now = SHARE_TTL_MS;
    expect(store.take(id, "sess-a")).toBeNull();
    expect(store.size).toBe(0);
    const ids = Array.from({ length: SHARE_LIMIT + 5 }, (_, i) => store.put("sess-a", { title: `t${i}` }));
    expect(store.size).toBe(SHARE_LIMIT);
    expect(store.take(ids[0] ?? "", "sess-a")).toBeNull();
    expect(store.take(ids[ids.length - 1] ?? "", "sess-a")).toEqual({ title: `t${SHARE_LIMIT + 4}` });
  });
});
