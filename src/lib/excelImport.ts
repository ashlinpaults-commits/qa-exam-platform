import * as XLSX from "xlsx";
import type { Question, Difficulty, QuestionType } from "@/types";
import { normalizeQuestionText } from "./questions";

// Matches the real question-bank export structure:
// columns: Question No. | Topic | Difficulty | Question | Answer | Scenario Based | QA | Verified | Comments
// One sheet per module (e.g. Scheduler, Patient Services, Clinical, RCM...).
function normalizeDifficulty(raw: unknown): Difficulty {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s.startsWith("hard")) return "hard";
  if (s.startsWith("med")) return "medium";
  return "easy";
}

function normalizeQuestionType(raw: unknown): QuestionType {
  const s = String(raw ?? "").trim().toLowerCase();
  if (
    s.includes("screen") ||
    s.includes("recording") ||
    s.includes("video") ||
    s.includes("walkthrough")
  ) {
    return "screen_recording";
  }
  if (s.includes("mcq") || s.includes("multiple")) return "mcq";
  if (s.includes("true") || s.includes("false") || s === "tf") return "true_false";
  if (s.includes("case") || s.includes("study") || s.includes("ticket")) return "case_study";
  if (s.includes("drag") || s.includes("order") || s.includes("sequence")) return "drag_drop_order";
  if (s.includes("image")) return "image_based";
  return "descriptive";
}

function cleanCellString(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const s = String(raw);
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

export interface ParsedRow {
  questionNo: string;
  module: string;
  feature: string;
  difficulty: Difficulty;
  type?: QuestionType;
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
  duplicates: ParsedRow[]; // valid rows whose question text repeats an earlier one
  skippedCount: number; // rows dropped for missing Question/Answer text
}

export function parseQuestionWorkbook(fileBuffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(fileBuffer, { type: "array" });
  const rows: ParsedRow[] = [];
  const duplicates: ParsedRow[] = [];
  const seenTexts = new Set<string>();
  let skippedCount = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const json: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

    for (const r of json) {
      const questionText = cleanCellString(r["Question"]);
      const expectedAnswer = cleanCellString(r["Answer"]);
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

      // Deduplicate strictly based on question text (word-for-word).
      // Identical question numbers across sections/sheets are ALLOWED.
      const rawId = String(r["Question No."] ?? "").trim();
      const dedupeKey = normalizeQuestionText(questionText);

      const row: ParsedRow = {
        questionNo: rawId || "(blank)",
        module: sheetName.trim(),
        feature: String(r["Topic"] ?? sheetName).trim(),
        difficulty: normalizeDifficulty(r["Difficulty"]),
        type: normalizeQuestionType(r["Type"] || r["Question Type"]),
        questionText,
        expectedAnswer,
        notes: String(r["Comments"] ?? "").trim() || undefined,
        tags,
        valid: true,
        duplicate: false,
      };

      if (seenTexts.has(dedupeKey)) {
        row.duplicate = true;
        duplicates.push(row);
        continue;
      }
      seenTexts.add(dedupeKey);
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
    type: r.type ?? "descriptive",
    questionText: r.questionText,
    expectedAnswer: r.expectedAnswer,
    notes: r.notes,
    sourceId: r.questionNo !== "(blank)" ? `${r.module}::${r.questionNo}` : undefined,
  }));
}
