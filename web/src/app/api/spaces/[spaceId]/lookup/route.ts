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
    });
    if (deps.photos) {
      const rows =
        "barcode" in query.data
          ? await deps.repo.findLibraryByBarcode(spaceId, query.data.barcode, {
              verifiedOnly: session.simpleMode,
            })
          : await deps.repo.searchLibrary(spaceId, query.data.q, {
              verifiedOnly: session.simpleMode,
            });
      for (const result of body.results) {
        if (result.source !== "library" || !("id" in result.food)) continue;
        const id = result.food.id;
        const key = rows.find((row) => row.id === id)?.photoKey;
        if (key)
          result.food.photo = {
            thumbUrl: await deps.photos.readUrl(key, "thumb"),
            originalUrl: await deps.photos.readUrl(key, "original"),
          };
      }
    }
    log.info("lookup.loaded", { spaceId, userId: session.userId, count: body.results.length });
    return json(LookupResponse.parse(body));
  } catch {
    throw new HttpError(503, "lookup-unavailable");
  }
});
