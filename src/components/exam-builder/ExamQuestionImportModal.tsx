"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Primitives";
import { parseQuestionWorkbook, rowsToQuestionInput, type ParseResult } from "@/lib/excelImport";
import { bulkCreateQuestions } from "@/lib/questions";
import { useAuth } from "@/context/AuthContext";
import type { Question } from "@/types";
import { Upload, Loader2, CheckCircle2, AlertTriangle, FileSpreadsheet, Info } from "lucide-react";

interface ExamQuestionImportModalProps {
  open: boolean;
  onClose: () => void;
  onQuestionsImported: (questions: Question[]) => void;
}

export function ExamQuestionImportModal({
  open,
  onClose,
  onQuestionsImported,
}: ExamQuestionImportModalProps) {
  const { profile } = useAuth();
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      setParsed(parseQuestionWorkbook(buffer));
    } catch {
      setError("Couldn't parse this spreadsheet. Please ensure it is a valid .xlsx file with the expected columns.");
    }
  }

  async function handleImport() {
    if (!profile || !parsed || parsed.rows.length === 0) return;
    setImporting(true);
    setProgress({ done: 0, total: parsed.rows.length });

    try {
      const inputRows = rowsToQuestionInput(parsed.rows);
      const result = await bulkCreateQuestions(
        inputRows,
        profile.uid,
        (done, total) => setProgress({ done, total }),
        200
      );

      if (result.failed > 0 && result.imported === 0) {
        setError(`Failed to import questions: ${result.failedBatches[0]?.error ?? "Unknown error"}`);
        setImporting(false);
        return;
      }

      // Immediately pass created questions into ExamBuilder
      onQuestionsImported(result.createdQuestions);
      reset();
      onClose();
    } catch (err) {
      console.error("Exam question import failed:", err);
      setError(err instanceof Error ? err.message : "Import failed. Please retry.");
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setParsed(null);
    setFileName("");
    setError(null);
    setProgress({ done: 0, total: 0 });
  }

  const progressPct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!importing) {
          reset();
          onClose();
        }
      }}
      title="Import Questions for This Exam"
      wide
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Upload an Excel spreadsheet containing the questions for this test. Accepted questions will be validated, saved to the repository, and immediately added to your exam questions list.
        </p>

        {!importing && (
          <label className="flex cursor-pointer flex-col items-center gap-2.5 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-7 text-center text-sm text-slate-500 hover:border-brand-400 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/40 dark:hover:border-brand-600">
            <FileSpreadsheet className="h-8 w-8 text-brand-600" />
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {fileName || "Choose an Excel spreadsheet (.xlsx)"}
            </span>
            <span className="text-xs text-slate-400">
              Columns: Question No., Topic, Difficulty, Question, Answer, Scenario Based, QA, Verified, Comments
            </span>
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
          </label>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {parsed && !importing && (
          <div className="space-y-3.5">
            {/* Validation Metrics */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-center dark:border-slate-700 dark:bg-slate-800">
                <p className="text-xl font-bold text-slate-900 dark:text-slate-100">{parsed.rows.length}</p>
                <p className="text-xs text-slate-500">Accepted</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-center dark:border-slate-700 dark:bg-slate-800">
                <p className="text-xl font-bold text-amber-600 dark:text-amber-400">{parsed.duplicates.length}</p>
                <p className="text-xs text-slate-500">Exact Duplicates</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-center dark:border-slate-700 dark:bg-slate-800">
                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{parsed.reusedNumbers.length}</p>
                <p className="text-xs text-slate-500">Reused Q# (Accepted)</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-3 text-center dark:border-slate-700 dark:bg-slate-800">
                <p className="text-xl font-bold text-slate-400">{parsed.skippedCount}</p>
                <p className="text-xs text-slate-500">Skipped (Blank)</p>
              </div>
            </div>

            {/* Reused Question No. Explanatory Banner */}
            {parsed.reusedNumbers.length > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 p-2.5 text-xs text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/20 dark:text-emerald-300">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong>{parsed.reusedNumbers.length}</strong> questions have recurring Question Numbers (e.g. #1, #2) from other sections or exams, but substantive question content is unique. They are accepted and will be imported.
                </span>
              </div>
            )}

            {/* Exact Duplicates Collapsible Notice */}
            {parsed.duplicates.length > 0 && (
              <details className="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                <summary className="cursor-pointer font-medium">
                  {parsed.duplicates.length} duplicate questions with identical text will be skipped
                </summary>
                <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto pl-2">
                  {parsed.duplicates.slice(0, 50).map((d, i) => (
                    <li key={i} className="truncate">
                      {d.module} — Q#{d.questionNo}: {d.questionText}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {/* Question Preview Table */}
            <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 dark:bg-slate-800">
                  <tr>
                    <th className="p-2.5">Q#</th>
                    <th className="p-2.5">Module</th>
                    <th className="p-2.5">Topic</th>
                    <th className="p-2.5">Question Preview</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {parsed.rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                      <td className="p-2.5 font-mono text-[11px] font-bold text-slate-500">#{r.questionNo}</td>
                      <td className="p-2.5 font-medium text-slate-800 dark:text-slate-200">{r.module}</td>
                      <td className="p-2.5 text-slate-500">{r.feature}</td>
                      <td className="max-w-xs truncate p-2.5 text-slate-700 dark:text-slate-300">{r.questionText}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.rows.length > 50 && (
                <p className="p-2 text-center text-xs text-slate-400">
                  +{parsed.rows.length - 50} more questions...
                </p>
              )}
            </div>

            <button
              className="btn-primary w-full py-2.5"
              onClick={handleImport}
              disabled={parsed.rows.length === 0}
            >
              Add {parsed.rows.length} Questions to Exam
            </button>
          </div>
        )}

        {importing && (
          <div className="space-y-3 py-6 text-center">
            <div className="flex items-center justify-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
              <span>Importing and adding questions ({progress.done} of {progress.total})...</span>
            </div>
            <div className="mx-auto h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
              <div className="h-full bg-brand-600 transition-all duration-300" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
