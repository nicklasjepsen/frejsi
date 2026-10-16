import { createEmit, toApiError, type SessionContext } from "@frejsi/shared";
import { json, sessionIdFrom } from "@/app/api/auth/http";
import { assertRole, loadSession } from "@/lib/auth/session";
import { resolveContributions, type ResolvedContributions } from "@/lib/contributions";

interface Context {
  spaceId: string;
  session: SessionContext;
  deps: ResolvedContributions;
}
interface Params {
  spaceId: string;
}
/** Session, errors and the one log line (`spaceId`, `userId`, `code`, `ms` only). */
export function contributionRoute(
  name: string,
  handler: (request: Request, context: Context) => Promise<Response>,
) {
  return async (request: Request, { params }: { params: Promise<Params> }): Promise<Response> => {
    const { spaceId } = await params;
    let deps: ResolvedContributions | undefined;
    let session: SessionContext | null = null;
    let code = "ok";
    let response: Response;
    const started = Date.now();
    try {
      deps = resolveContributions();
      const sessionId = sessionIdFrom(request);
      session = sessionId
        ? await loadSession(sessionId, {
            db: deps.sessionDb,
            now: deps.now,
            emit: createEmit({ db: deps.db, sink: deps.sink, now: deps.now }),
          })
        : null;
      // Viewer 403 and non-member 404 here, before any food read or outbound call.
      const authorized = assertRole(session, spaceId, "owner", "carer");
      response = await handler(request, { spaceId, session: authorized.session, deps });
    } catch (error) {
      const api = toApiError(error);
      code = api.body.error.code;
      response = json(api.body, { status: api.status });
    }
    // Explicit allow-list: never the barcode, a value, a name, a URL or an exception message.
    deps?.log.raw(
      JSON.stringify({
        ts: deps.now().toISOString(),
        level: response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info",
        msg: "contributions.request",
        route: name,
        spaceId,
        ...(session ? { userId: session.userId } : {}),
        code,
        ms: Date.now() - started,
      }),
    );
    return response;
  };
}
