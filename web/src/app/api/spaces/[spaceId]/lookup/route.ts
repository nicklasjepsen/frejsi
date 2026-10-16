import {
  HttpError,
  LookupQuery,
  LookupResponse,
  lookup,
  normaliseBarcode,
  log,
} from "@frejsi/shared";
import { json, requireSpaceRole, spaceRoute } from "@/lib/live/server";
import { lookupDeps, lookupSessionDb } from "./server";

export const GET = spaceRoute("lookup.get", async (request, spaceId) => {
  const { session } = await requireSpaceRole(
    request,
    spaceId,
    ["owner", "carer"],
    lookupSessionDb(),
  );
  const deps = lookupDeps();
  const photos = deps.photos;
  const params = new URL(request.url).searchParams;
  const barcode = params.get("barcode");
  if (barcode !== null && !normaliseBarcode(barcode)) throw new HttpError(400, "barcode-invalid");
  const remote = params.get("remote");
  if (remote !== null && remote !== "true" && remote !== "false")
    throw new HttpError(400, "validation");
  if (barcode !== null && (params.has("q") || remote !== null))
    throw new HttpError(400, "validation");
  const query = LookupQuery.safeParse(
    barcode !== null ? { barcode } : { q: params.get("q"), remote: remote !== "false" },
  );
  if (!query.success) throw new HttpError(400, "validation");
  try {
    const body = await lookup(deps.repo, deps.sources, {
      spaceId,
      session,
      locale: session.locale,
      query: query.data,
      ...(photos
        ? {
            photo: async (key: string) => ({
              thumbUrl: await photos.readUrl(key, "thumb"),
              originalUrl: await photos.readUrl(key, "original"),
            }),
          }
        : {}),
      embed:
        "q" in query.data && query.data.remote && query.data.q.length >= 3
          ? await deps.searchEmbedding(spaceId, session)
          : null,
    });
    log.info("lookup.loaded", { spaceId, userId: session.userId, count: body.results.length });
    return json(LookupResponse.parse(body));
  } catch {
    throw new HttpError(503, "lookup-unavailable");
  }
});
