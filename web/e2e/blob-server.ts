// A loopback-only Blob HTTP fake for the release build check. The real BlobPhotoStore speaks
// its normal wire protocol; no Azure SDK or credentials are used by this server.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { BLOB_PORT } from "./env";

const blobs = new Map<string, Buffer>();
async function serve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const key = new URL(request.url ?? "/", "http://localhost").pathname;
  if (key === "/health") {
    response.writeHead(200).end("ok");
    return;
  }
  if (!key.startsWith("/fictional/photos/spaces/")) {
    response.writeHead(404).end();
    return;
  }
  if (request.method === "PUT") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
    blobs.set(key, Buffer.concat(chunks));
    response
      .writeHead(201, { etag: '"fictional"', "last-modified": new Date().toUTCString() })
      .end();
  } else if (request.method === "DELETE") {
    const existed = blobs.delete(key);
    response
      .writeHead(existed ? 202 : 404, { "x-ms-error-code": existed ? "" : "BlobNotFound" })
      .end();
  } else {
    const bytes = blobs.get(key);
    if (!bytes) response.writeHead(404, { "x-ms-error-code": "BlobNotFound" }).end();
    else
      response
        .writeHead(200, { "content-type": "image/jpeg", "content-length": bytes.length })
        .end(request.method === "HEAD" ? undefined : bytes);
  }
}
createServer((request, response) => {
  void serve(request, response).catch(() => response.writeHead(500).end());
}).listen(BLOB_PORT, "127.0.0.1");
