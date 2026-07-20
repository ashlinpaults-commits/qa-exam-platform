import * as XLSX from "xlsx";
import type { Question, Difficulty } from "@/types";

// Matches the real question-bank export structure:
// columns: Question No. | Topic | Difficulty | Question | Answer | Scenario Based | QA | Verified | Comments
// One sheet per module (e.g. Scheduler, Patient Services, Clinical, RCM...).
function normalizeDifficulty(raw: unknown): Difficulty {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s.startsWith("hard")) return "hard";
  if (s.startsWith("med")) return "medium";
  return "easy";
}

export interface ParsedRow {
  questionNo: string;
  module: string;
  feature: string;
  difficulty: Difficulty;
  questionText: string;
  expectedAnswer: string;
  notes?: string;
  tags: string[];
  valid: boolean;
  duplicate: boolean;
  error?: string;
}

export interface ParseResult {
  rows: ParsedRow[]; // valid, non-duplicate rows — these are the ones that get uploaded
  duplicates: ParsedRow[]; // valid rows whose Question No. repeats an earlier one
  skippedCount: number; // rows dropped for missing Question/Answer text
}

export function parseQuestionWorkbook(fileBuffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(fileBuffer, { type: "array" });
  const rows: ParsedRow[] = [];
  const duplicates: ParsedRow[] = [];
  const seenIds = new Set<string>();
  let skippedCount = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const json: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

    for (const r of json) {
      const questionText = String(r["Question"] ?? "").trim();
      const expectedAnswer = String(r["Answer"] ?? "").trim();
      if (!questionText || !expectedAnswer) {
        skippedCount++;
        continue; // blank trailing rows etc.
      }

      const tags: string[] = [];
      const scenarioBased = String(r["Scenario Based"] ?? "").trim().toLowerCase();
      if (scenarioBased === "yes") tags.push("scenario-based");
      const qaReviewer = String(r["QA"] ?? "").trim();
      if (qaReviewer) tags.push(`reviewed:${qaReviewer}`);
      const verified = String(r["Verified"] ?? "").trim().toLowerCase();
      if (verified === "yes") tags.push("verified");

      // "Question No." is the sheet's own ID column; dedupe key is module+id
      // since IDs commonly restart per sheet (e.g. every module starting at 1).
      const rawId = String(r["Question No."] ?? "").trim();
      const dedupeKey = `${sheetName.trim()}::${rawId}`;

      const row: ParsedRow = {
        questionNo: rawId || "(blank)",
        module: sheetName.trim(),
        feature: String(r["Topic"] ?? sheetName).trim(),
        difficulty: normalizeDifficulty(r["Difficulty"]),
        questionText,
        expectedAnswer,
        notes: String(r["Comments"] ?? "").trim() || undefined,
        tags,
        valid: true,
        duplicate: false,
      };

      if (rawId && seenIds.has(dedupeKey)) {
        row.duplicate = true;
        duplicates.push(row);
        continue;
      }
      if (rawId) seenIds.add(dedupeKey);
      rows.push(row);
    }
  }
  return { rows, duplicates, skippedCount };
}

export function rowsToQuestionInput(
  rows: ParsedRow[]
): Omit<Question, "id" | "createdAt" | "updatedAt" | "version" | "stats" | "createdBy">[] {
  return rows.map((r) => ({
    module: r.module,
    feature: r.feature,
    difficulty: r.difficulty,
    tags: r.tags,
    type: "descriptive" as const,
    questionText: r.questionText,
    expectedAnswer: r.expectedAnswer,
    notes: r.notes,
    sourceId: r.questionNo !== "(blank)" ? `${r.module}::${r.questionNo}` : undefined,
  }));
}
