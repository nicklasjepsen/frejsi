export interface InsightRow {
  id: string;
  spaceId: string;
  kind: "meal" | "week";
  subjectKey: string;
  statsHash: string;
  text: string;
  questions: string[];
  questionsEdited: boolean;
  rejectedCount: number;
  provider: string;
  model: string;
  createdAt: Date;
  verified: false;
}
export type InsightWrite = Omit<InsightRow, "id" | "createdAt" | "questionsEdited" | "verified">;
export interface InsightRepository {
  find(spaceId: string, kind: InsightRow["kind"], subjectKey: string): Promise<InsightRow | null>;
  /** Called only by store.ts after validation. */
  save(input: InsightWrite): Promise<InsightRow>;
  edit(spaceId: string, id: string, questions: string[]): Promise<InsightRow>;
}
