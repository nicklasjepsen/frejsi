import type { InsightRepository, InsightRow, InsightWrite } from "./types";
export class MemoryInsightRepository implements InsightRepository {
  readonly rows: InsightRow[] = [];
  find(spaceId: string, kind: InsightRow["kind"], subjectKey: string) {
    return Promise.resolve(
      this.rows.find(
        (r) => r.spaceId === spaceId && r.kind === kind && r.subjectKey === subjectKey,
      ) ?? null,
    );
  }
  async save(input: InsightWrite) {
    const existing = await this.find(input.spaceId, input.kind, input.subjectKey);
    const row: InsightRow = {
      ...input,
      id: existing?.id ?? String(this.rows.length + 1),
      createdAt: new Date(),
      questionsEdited: false,
      verified: false,
    };
    if (existing) this.rows.splice(this.rows.indexOf(existing), 1, row);
    else this.rows.push(row);
    return row;
  }
  edit(spaceId: string, id: string, questions: string[]) {
    const row = this.rows.find((r) => r.id === id && r.spaceId === spaceId);
    if (!row) throw new Error("Unknown insight");
    Object.assign(row, { questions: [...questions], questionsEdited: true });
    return Promise.resolve(row);
  }
}

import type { Reading } from "../schemas/glucose";
import type { WeekMeal, WeekSource, WeekSpace } from "./week-input";
export class MemoryWeekSource implements WeekSource {
  readonly enabledSpaces: WeekSpace[] = [];
  readonly meals: WeekMeal[] = [];
  readonly readings: Reading[] = [];
  spaces() {
    return Promise.resolve(this.enabledSpaces);
  }
  readingsBetween(_spaceId: string, from: Date, to: Date) {
    return Promise.resolve(
      this.readings.filter((r) => Date.parse(r.ts) >= +from && Date.parse(r.ts) <= +to),
    );
  }
  mealsBetween(_spaceId: string, from: Date, to: Date) {
    return Promise.resolve(
      this.meals.filter((r) => Date.parse(r.ts) >= +from && Date.parse(r.ts) < +to),
    );
  }
}
