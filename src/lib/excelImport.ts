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

/**
 * Generates a normalized substantive content fingerprint for duplicate detection.
 * Based on normalized question text and expected answer within a module,
 * ensuring two different questions with the same "Question No." are NEVER falsely treated as duplicates.
 */
export function createQuestionFingerprint(questionText: string, expectedAnswer = "", module = ""): string {
  const normText = String(questionText ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const normAnswer = String(expectedAnswer ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const normModule = String(module ?? "").toLowerCase().trim();

  return `${normModule}::${normText}::${normAnswer.slice(0, 100)}`;
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
  isReusedQuestionNo?: boolean;
  fingerprint: string;
  error?: string;
}

interface RichTextRun {
  t?: string;
  rPr?: {
    b?: boolean;
    i?: boolean;
    u?: boolean;
    strike?: boolean;
    color?: { rgb?: string };
  };
}

function extractCellFormattedText(cell: XLSX.CellObject | undefined, fallback: unknown): string {
  if (cell) {
    const rawCell = cell as { r?: RichTextRun[]; w?: string; v?: unknown };
    if (Array.isArray(rawCell.r) && rawCell.r.length > 0) {
      const formatted = rawCell.r
        .map((run) => {
          let t = run.t || "";
          if (!t) return "";
          if (run.rPr?.b) t = `**${t}**`;
          if (run.rPr?.i) t = `*${t}*`;
          if (run.rPr?.u) t = `<u>${t}</u>`;
          if (run.rPr?.strike) t = `~~${t}~~`;
          if (run.rPr?.color?.rgb) t = `[color:#${run.rPr.color.rgb}]${t}[/color]`;
          return t;
        })
        .join("")
        .trim();
      if (formatted) return formatted;
    }
    if (typeof rawCell.w === "string" && rawCell.w.trim()) {
      return rawCell.w.trim();
    }
  }
  return String(fallback ?? "").trim();
}

export interface ParseResult {
  rows: ParsedRow[]; // valid, non-duplicate rows — these get uploaded
  duplicates: ParsedRow[]; // true substantive duplicates (identical question text + answer)
  reusedNumbers: ParsedRow[]; // legitimately different questions that happen to share a Question No. (accepted!)
  skippedCount: number; // rows dropped for missing Question/Answer text
}

export function parseQuestionWorkbook(fileBuffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(fileBuffer, { type: "array", cellStyles: true });
  const rows: ParsedRow[] = [];
  const duplicates: ParsedRow[] = [];
  const reusedNumbers: ParsedRow[] = [];
  const seenFingerprints = new Set<string>();
  const seenQuestionNos = new Set<string>();
  let skippedCount = 0;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    // Detect column index for "Question" to enable rich text extraction
    let questionCol = -1;
    let range: XLSX.Range | undefined;
    if (ws["!ref"]) {
      range = XLSX.utils.decode_range(ws["!ref"]);
      for (let c = range.s.c; c <= range.e.c; c++) {
        const headerCell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
        const headerVal = String(headerCell?.v ?? "").trim().toLowerCase();
        if (headerVal === "question" || headerVal.includes("question text")) {
          questionCol = c;
          break;
        }
      }
    }

    const json: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

    for (let rowIdx = 0; rowIdx < json.length; rowIdx++) {
      const r = json[rowIdx];
      const excelRowIndex = range ? range.s.r + 1 + rowIdx : -1;
      const qCell = questionCol >= 0 && excelRowIndex >= 0
        ? ws[XLSX.utils.encode_cell({ r: excelRowIndex, c: questionCol })]
        : undefined;

      const questionText = extractCellFormattedText(qCell, r["Question"]);
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

      const rawId = String(r["Question No."] ?? "").trim();
      const dedupeNumberKey = `${sheetName.trim()}::${rawId}`;
      const fingerprint = createQuestionFingerprint(questionText, expectedAnswer, sheetName.trim());

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
        fingerprint,
      };

      // 1. Check for exact substantive duplicate (same question text and answer within sheet)
      if (seenFingerprints.has(fingerprint)) {
        row.duplicate = true;
        duplicates.push(row);
        continue;
      }

      // 2. Check if Question No. was previously seen, but content is different
      if (rawId && seenQuestionNos.has(dedupeNumberKey)) {
        row.isReusedQuestionNo = true;
        reusedNumbers.push(row);
      }

      if (rawId) seenQuestionNos.add(dedupeNumberKey);
      seenFingerprints.add(fingerprint);
      rows.push(row);
    }
  }
  return { rows, duplicates, reusedNumbers, skippedCount };
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
    fingerprint: r.fingerprint,
  }));
}
