import { randomUUID } from "node:crypto";
import {
  CreateSymptomRequest,
  HttpError,
  SymptomRangeQuery,
  SymptomView,
  SymptomsView,
  UpdateSymptomRequest,
  isKnownKind,
  type SessionContext,
  type SpaceSymptomKind,
} from "@frejsi/shared";
import { SYMPTOM_WINDOW_MINUTES, type LoggedSymptom } from "@frejsi/shared/ai/insight/input";
import { PrismaSymptomRepository, type SymptomRecord, type SymptomRepository } from "./repository";
import { createSymptomWriter, type SymptomWriter } from "./transaction";

export interface SymptomDeps {
  repo: SymptomRepository;
  write: SymptomWriter;
  now: () => Date;
}
export function symptomDeps(overrides: Partial<SymptomDeps> = {}): SymptomDeps {
  return {
    repo: overrides.repo ?? new PrismaSymptomRepository(),
    write: overrides.write ?? createSymptomWriter(undefined, undefined, overrides.now),
    now: overrides.now ?? (() => new Date()),
  };
}
function view(row: SymptomRecord): SymptomView {
  return SymptomView.parse({
    id: row.id,
    kind: row.kind,
    ts: row.ts,
    ...(row.severity ? { severity: row.severity } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.resolvedTs ? { resolvedTs: row.resolvedTs } : {}),
    byUserId: row.byUserId,
    byName: row.byName,
  });
}
function parsed<T>(
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
  input: unknown,
): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new HttpError(400, "validation");
  return result.data;
}
/** A simpleMode session logs a kind at now and nothing more (plan §5, decision 7 of §13). */
const NOT_IN_SIMPLE_MODE = ["severity", "note", "ts"] as const;
function checkSimpleCreate(session: SessionContext, raw: unknown): void {
  if (!session.simpleMode || typeof raw !== "object" || raw === null) return;
  if (NOT_IN_SIMPLE_MODE.some((key) => key in raw)) throw new HttpError(400, "simple-mode");
}
async function checkKind(spaceId: string, kind: string, repo: SymptomRepository): Promise<void> {
  const kinds = await repo.spaceKinds(spaceId);
  if (!kinds) throw new HttpError(404, "not-found");
  if (!isKnownKind(kind, kinds)) throw new HttpError(400, "symptom-kind-unknown");
}
async function load(spaceId: string, id: string, deps: SymptomDeps): Promise<SymptomRecord> {
  const row = await deps.repo.find(spaceId, id);
  if (!row) throw new HttpError(404, "symptom-not-found");
  return row;
}

/** The space's kinds beyond the six defaults, for the picker and the Say sheet. */
export async function listSymptomKinds(
  spaceId: string,
  overrides: Partial<SymptomDeps> = {},
): Promise<SpaceSymptomKind[]> {
  const kinds = await symptomDeps(overrides).repo.spaceKinds(spaceId);
  if (!kinds) throw new HttpError(404, "not-found");
  return kinds;
}
export async function listSymptoms(
  spaceId: string,
  query: unknown,
  overrides: Partial<SymptomDeps> = {},
): Promise<SymptomsView> {
  const deps = symptomDeps(overrides);
  const { from, to } = parsed(SymptomRangeQuery, query);
  const rows = await deps.repo.range(spaceId, from, to);
  return SymptomsView.parse({ symptoms: rows.map(view) });
}
export async function createSymptom(
  spaceId: string,
  session: SessionContext,
  input: unknown,
  overrides: Partial<SymptomDeps> = {},
): Promise<SymptomView> {
  const deps = symptomDeps(overrides);
  checkSimpleCreate(session, input);
  const data = parsed(CreateSymptomRequest, input);
  await checkKind(spaceId, data.kind, deps.repo);
  const explicitTs =
    typeof input === "object" && input !== null && "ts" in input && input.ts !== undefined;
  const id = randomUUID();
  const row = await deps.write(async (repo, emit) => {
    const saved = await repo.create({
      id,
      spaceId,
      byUserId: session.userId,
      ts: explicitTs ? data.ts : deps.now().toISOString(),
      kind: data.kind,
      severity: data.severity,
      note: data.note,
    });
    await emit(spaceId, "symptom.created", {
      symptomId: id,
      ts: saved.ts,
      kind: saved.kind,
      byUserId: session.userId,
    });
    return saved;
  });
  return view(row);
}
export async function updateSymptom(
  spaceId: string,
  id: string,
  session: SessionContext,
  input: unknown,
  overrides: Partial<SymptomDeps> = {},
): Promise<SymptomView> {
  const deps = symptomDeps(overrides);
  if (session.simpleMode) throw new HttpError(400, "simple-mode");
  const data = parsed(UpdateSymptomRequest, input);
  if (data.kind !== undefined) await checkKind(spaceId, data.kind, deps.repo);
  await load(spaceId, id, deps);
  const row = await deps.write(async (repo, emit) => {
    const saved = await repo.update(spaceId, id, data);
    await emit(spaceId, "symptom.updated", { symptomId: id });
    return saved;
  });
  return view(row);
}
/** Owner and carer only, any member's symptom: a carer may delete what the child logged. */
export async function deleteSymptom(
  spaceId: string,
  id: string,
  session: SessionContext,
  overrides: Partial<SymptomDeps> = {},
): Promise<void> {
  const deps = symptomDeps(overrides);
  if (session.simpleMode) throw new HttpError(400, "simple-mode");
  await deps.write(async (repo, emit) => {
    await repo.delete(spaceId, id);
    await emit(spaceId, "symptom.deleted", { symptomId: id });
  });
}
/**
 * The symptoms within an hour before and four hours after a meal, as the narration input takes
 * them: kind and instant, never the note. Empty when the meal is not in the space.
 */
export async function symptomsAroundMeal(
  spaceId: string,
  mealId: string,
  overrides: Partial<SymptomDeps> = {},
): Promise<LoggedSymptom[]> {
  const deps = symptomDeps(overrides);
  const mealTs = await deps.repo.mealTs(spaceId, mealId);
  if (!mealTs) return [];
  const meal = Date.parse(mealTs);
  const from = new Date(meal - SYMPTOM_WINDOW_MINUTES.before * 60_000).toISOString();
  const to = new Date(meal + SYMPTOM_WINDOW_MINUTES.after * 60_000).toISOString();
  const rows = await deps.repo.range(spaceId, from, to);
  return rows.map(({ kind, ts }) => ({ kind, ts }));
}
