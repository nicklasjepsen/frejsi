import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { BlobPhotoStore, createPhotoStoreFromEnv, type PhotoHttpClient } from "./blob";
import type { PhotoStore } from "./types";

const account = "fictionphotos";
const accountKey = Buffer.alloc(32, 7).toString("base64");
const connection = `DefaultEndpointsProtocol=https;AccountName=${account};AccountKey=${accountKey};EndpointSuffix=core.windows.net`;
const key = "spaces/fiction-space/foods/fiction-food/fiction-upload";

function transport(fail = "") {
  const blobs = new Map<string, Buffer>();
  const headers = new Map<string, string | undefined>();
  const requests: string[] = [];
  const client: PhotoHttpClient = {
    async sendRequest(request) {
      const path = new URL(request.url).pathname;
      requests.push(`${request.method} ${path}`);
      if (`${request.method} ${path}` === fail) {
        request.headers.set("x-ms-error-code", "AuthorizationFailure");
        return {
          request,
          status: 403,
          headers: request.headers,
          bodyAsText: "fictional-sensitive-detail",
        };
      }
      let status = 201;
      if (request.method === "PUT") {
        const requestBody: unknown = request.body;
        const body: unknown =
          typeof requestBody === "function" ? (requestBody as () => unknown)() : requestBody;
        const chunks: Buffer[] = [];
        if (body instanceof Readable) {
          for await (const chunk of body as AsyncIterable<Uint8Array>)
            chunks.push(Buffer.from(chunk));
        } else if (body instanceof Uint8Array) chunks.push(Buffer.from(body));
        else throw new Error("Unexpected SDK body");
        blobs.set(path, Buffer.concat(chunks));
        headers.set(path, request.headers.get("x-ms-blob-content-type"));
      } else if (request.method === "DELETE") {
        status = blobs.delete(path) ? 202 : 404;
        if (status === 404) request.headers.set("x-ms-error-code", "BlobNotFound");
      } else throw new Error("Unexpected SDK request");
      return {
        request,
        status,
        headers: request.headers,
        bodyAsText: "",
      };
    },
  };
  return { client, blobs, headers, requests };
}

function signature(url: URL) {
  const q = url.searchParams;
  // Service SAS string-to-sign for the version emitted by the real SDK (no network).
  const fields = [
    q.get("sp"),
    q.get("st"),
    q.get("se"),
    `/blob/${account}${url.pathname}`,
    q.get("si"),
    q.get("sip"),
    q.get("spr"),
    q.get("sv"),
    q.get("sr"),
    "",
    q.get("ses"),
    q.get("rscc"),
    q.get("rscd"),
    q.get("rsce"),
    q.get("rscl"),
    q.get("rsct"),
  ];
  return createHmac("sha256", Buffer.from(accountKey, "base64"))
    .update(fields.join("\n"))
    .digest("base64");
}

describe("BlobPhotoStore", () => {
  it("writes both processed JPEGs to the private container and deletes both idempotently", async () => {
    const http = transport();
    const store: PhotoStore = new BlobPhotoStore(connection, { httpClient: http.client });
    const photos = {
      original: new Uint8Array([255, 216, 1]),
      thumb: new Uint8Array([255, 216, 2]),
    };
    await store.put(key, photos);
    expect(http.blobs.get(`/photos/${key}/original.jpg`)).toEqual(Buffer.from(photos.original));
    expect(http.blobs.get(`/photos/${key}/thumb.jpg`)).toEqual(Buffer.from(photos.thumb));
    expect([...http.headers.values()]).toEqual(["image/jpeg", "image/jpeg"]);
    await store.delete(key);
    expect(http.blobs.size).toBe(0);
    await store.delete(key);
    expect(http.requests.filter((r) => r.startsWith("DELETE"))).toHaveLength(4);
  });

  it("cleans up an incomplete upload and exposes only a domain error", async () => {
    const http = transport(`PUT /photos/${key}/thumb.jpg`);
    const store = new BlobPhotoStore(connection, { httpClient: http.client });
    await expect(
      store.put(key, { original: new Uint8Array([1]), thumb: new Uint8Array([2]) }),
    ).rejects.toThrow(/^photo-unavailable$/);
    expect(http.blobs.size).toBe(0);
  });

  it("attempts both deletions when one fails and hides SDK error details", async () => {
    const http = transport(`DELETE /photos/${key}/original.jpg`);
    const store = new BlobPhotoStore(connection, { httpClient: http.client });
    await store.put(key, { original: new Uint8Array([1]), thumb: new Uint8Array([2]) });
    await expect(store.delete(key)).rejects.toThrow(/^photo-unavailable$/);
    expect(http.blobs.has(`/photos/${key}/thumb.jpg`)).toBe(false);
    expect(http.blobs.has(`/photos/${key}/original.jpg`)).toBe(true);
  });

  it("signs read-only SAS URLs, stable within the hour, expiring next full hour plus one", async () => {
    let now = new Date("2026-10-15T12:37:29Z");
    const http = transport();
    const store = new BlobPhotoStore(connection, { now: () => now, httpClient: http.client });
    const first = await store.readUrl(key, "thumb");
    const url = new URL(first);
    expect(url.origin).toBe(`https://${account}.blob.core.windows.net`);
    expect(url.pathname).toBe(`/photos/${key}/thumb.jpg`);
    expect(url.searchParams.get("se")).toBe("2026-10-15T14:00:00Z");
    expect(url.searchParams.get("sp")).toBe("r");
    expect(url.searchParams.get("spr")).toBe("https");
    expect(url.searchParams.get("sr")).toBe("b");
    expect(url.searchParams.get("sig")).toBe(signature(url));
    expect(first).not.toContain(accountKey);
    expect(first).not.toContain("AccountKey");
    now = new Date("2026-10-15T12:59:59Z");
    expect(await store.readUrl(key, "thumb")).toBe(first);
    now = new Date("2026-10-15T13:00:00Z");
    const next = new URL(await store.readUrl(key, "original"));
    expect(next.pathname).toBe(`/photos/${key}/original.jpg`);
    expect(next.searchParams.get("se")).toBe("2026-10-15T15:00:00Z");
    expect(http.requests).toEqual([]);
  });

  it("supports an explicit Azurite endpoint including its account path", async () => {
    const local = `DefaultEndpointsProtocol=http;AccountName=${account};AccountKey=${accountKey};BlobEndpoint=http://127.0.0.1:10000/${account}`;
    const store = new BlobPhotoStore(local);
    const url = new URL(await store.readUrl(key, "thumb"));
    expect(url.pathname).toBe(`/${account}/photos/${key}/thumb.jpg`);
    expect(url.searchParams.get("spr")).toBe("https,http");
  });

  it("rejects invalid keys before the SDK sends a request", async () => {
    const http = transport();
    const store = new BlobPhotoStore(connection, { httpClient: http.client });
    await expect(
      store.put("../other", { original: new Uint8Array(), thumb: new Uint8Array() }),
    ).rejects.toThrow("photo-key");
    await expect(store.delete("../other")).rejects.toThrow("photo-key");
    await expect(store.readUrl("../other", "thumb")).rejects.toThrow("photo-key");
    expect(http.requests).toEqual([]);
  });

  it("is optional without configuration and keeps invalid configuration out of errors", () => {
    expect(createPhotoStoreFromEnv({})).toBeNull();
    expect(createPhotoStoreFromEnv({ BLOB_CONNECTION_STRING: connection })).toBeInstanceOf(
      BlobPhotoStore,
    );
    expect(() =>
      createPhotoStoreFromEnv({ BLOB_CONNECTION_STRING: "fictional-invalid-value" }),
    ).toThrow("photo-unavailable");
  });
});
