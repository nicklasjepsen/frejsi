import {
  AddCandidateRequest,
  HttpError,
  type FoodCandidate,
  type FoodSource,
  type Locale,
} from "@frejsi/shared";

/** One bounded call to a source: 2.5 s, then the signal aborts and the pick is unavailable. */
async function bounded<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => run(controller.signal)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("timeout"));
        }, 2500);
      }),
    ]);
  } catch {
    throw new HttpError(503, "lookup-unavailable");
  } finally {
    clearTimeout(timer);
  }
}

/** Client fields identify a pick, but can never author cross-space source data. */
export async function confirmRemoteCandidate(
  source: FoodSource,
  candidate: FoodCandidate & { barcode: string },
): Promise<FoodCandidate> {
  const result = await bounded((signal) => source.byBarcode(candidate.barcode, signal));
  if (result.status !== "ok") throw new HttpError(503, "lookup-unavailable");
  const found = result.candidates.find(
    (food) =>
      food.sourceRef === candidate.sourceRef ||
      (candidate.sourceRef === `${source.id}:${candidate.barcode}` &&
        food.barcode === candidate.barcode),
  );
  if (!found) throw new HttpError(400, "validation");
  const parsed = AddCandidateRequest.safeParse({
    candidate: { ...found, origin: source.id, sourceRef: candidate.sourceRef },
  });
  if (!parsed.success) throw new HttpError(503, "lookup-unavailable");
  return parsed.data.candidate;
}

/**
 * A pick from a source that answers by reference (a local dataset such as Frida): the whole
 * candidate, its category included, is read from the source again; the client's copy only
 * identifies it. A reference the source does not know is a bad request.
 */
export async function resolveCandidateByRef(
  source: FoodSource & { byRef: NonNullable<FoodSource["byRef"]> },
  candidate: FoodCandidate,
  locale: Locale,
): Promise<FoodCandidate> {
  const found = await bounded((signal) => source.byRef(candidate.sourceRef, locale, signal));
  if (found?.sourceRef !== candidate.sourceRef) throw new HttpError(400, "validation");
  const parsed = AddCandidateRequest.safeParse({
    candidate: { ...found, origin: source.id, sourceRef: candidate.sourceRef },
  });
  if (!parsed.success) throw new HttpError(503, "lookup-unavailable");
  return parsed.data.candidate;
}
