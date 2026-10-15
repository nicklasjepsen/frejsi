import { createEmit, HttpError, toApiError, type SessionContext } from "@frejsi/shared";
import { json, sessionIdFrom } from "@/app/api/auth/http";
import { assertRole, loadSession } from "@/lib/auth/session";
import { resolveFoods, type ResolvedFoods } from "@/lib/foods/core";

interface Context {
  spaceId: string;
  foodId: string;
  session: SessionContext;
  deps: ResolvedFoods;
  count: number;
}
interface Params {
  spaceId: string;
  foodId?: string;
}
export function foodRoute(
  name: string,
  handler: (request: Request, context: Context) => Promise<Response>,
) {
  return async (request: Request, { params }: { params: Promise<Params> }): Promise<Response> => {
    const { spaceId, foodId = "" } = await params;
    let deps: ResolvedFoods | undefined;
    let session: SessionContext | null = null;
    let count = 0;
    let code = "ok";
    let response: Response;
    try {
      deps = resolveFoods();
      const sessionId = sessionIdFrom(request);
      session = sessionId
        ? await loadSession(sessionId, {
            db: deps.sessionDb,
            now: deps.now,
            emit: createEmit({ db: deps.db, sink: deps.sink, now: deps.now }),
          })
        : null;
      const authorized = assertRole(session, spaceId, "owner", "carer");
      const context = { spaceId, foodId, session: authorized.session, deps, count: 0 };
      response = await handler(request, context);
      count = context.count;
    } catch (error) {
      const api = toApiError(error);
      code = api.body.error.code;
      response = json(api.body, { status: api.status });
    }
    // Explicit allow-list, including foodId (the shared logger's fields predate food routes).
    // Never include request URLs, bodies, exception messages, names, barcodes or signed URLs.
    deps?.log.raw(
      JSON.stringify({
        ts: deps.now().toISOString(),
        level: response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info",
        msg: "foods.request",
        route: name,
        spaceId,
        ...(session ? { userId: session.userId } : {}),
        ...(foodId ? { foodId } : {}),
        count,
        code,
      }),
    );
    return response;
  };
}

/** Bound the stream even if Content-Length is absent or dishonest. */
export async function photoBytes(request: Request): Promise<Uint8Array> {
  const limit = 8 * 1024 * 1024;
  if (Number(request.headers.get("content-length")) > limit)
    throw new HttpError(400, "photo-too-large");
  if (!request.body) throw new HttpError(400, "photo-type");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new HttpError(400, "photo-too-large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
