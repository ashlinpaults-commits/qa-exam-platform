"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Primitives";
import { parseQuestionWorkbook, rowsToQuestionInput, type ParsedRow, type ParseResult } from "@/lib/excelImport";
import { bulkCreateQuestions, type BulkImportSummary } from "@/lib/questions";
import { useAuth } from "@/context/AuthContext";
import { Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

export function ExcelImportModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const { profile } = useAuth();
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<BulkImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSummary(null);
    setFileName(file.name);
    try {
      const buffer = await file.arrayBuffer();
      setParsed(parseQuestionWorkbook(buffer));
    } catch (err) {
      setError("Couldn't parse that file. Make sure it's a .xlsx with the expected columns.");
    }
  }

  async function handleImport() {
    if (!profile || !parsed) return;
    setImporting(true);
    setProgress({ done: 0, total: parsed.rows.length });
    try {
      const inputRows = rowsToQuestionInput(parsed.rows);
      const result = await bulkCreateQuestions(
        inputRows as any,
        profile.uid,
        (done, total) => setProgress({ done, total }),
        200 // batch size — small on purpose so one bad batch can't take down the run
      );
      setSummary(result);
      onImported();
    } catch (err) {
      console.error("Excel import failed:", err);
      const message = err instanceof Error ? err.message : String(err);
      setError(`Import stopped: ${message}`);
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setParsed(null);
    setFileName("");
    setSummary(null);
    setError(null);
    setProgress({ done: 0, total: 0 });
  }

  const byModule = (parsed?.rows ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.module] = (acc[r.module] ?? 0) + 1;
    return acc;
  }, {});

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
      title="Import questions from Excel"
      wide
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Expects one sheet per module, columns: <code>Question No.</code>, <code>Topic</code>,{" "}
          <code>Difficulty</code>, <code>Question</code>, <code>Answer</code>, <code>Scenario Based</code>,{" "}
          <code>QA</code>, <code>Verified</code>, <code>Comments</code>. Rows missing Question or Answer are
          skipped. Rows repeating a <code>Question No.</code> already seen in the same sheet are flagged as
          duplicates and not uploaded.
        </p>

        {!importing && !summary && (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 hover:border-brand-400 dark:border-slate-700">
            <Upload className="h-6 w-6" />
            {fileName || "Click to choose an .xlsx file"}
            <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
          </label>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        {parsed && !importing && !summary && (
          <div className="space-y-3">
            <div className="card grid grid-cols-3 gap-3 p-4 text-center">
              <div>
                <p className="text-xl font-semibold">{parsed.rows.length}</p>
                <p className="text-xs text-slate-500">Ready to import</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-amber-500">{parsed.duplicates.length}</p>
                <p className="text-xs text-slate-500">Duplicate Question No.</p>
              </div>
              <div>
                <p className="text-xl font-semibold text-slate-400">{parsed.skippedCount}</p>
                <p className="text-xs text-slate-500">Skipped (blank rows)</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {Object.entries(byModule).map(([mod, count]) => (
                <span key={mod} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs dark:bg-slate-700">
                  {mod}: {count}
                </span>
              ))}
            </div>

            {parsed.duplicates.length > 0 && (
              <details className="rounded-lg bg-amber-50 p-3 text-xs dark:bg-amber-900/20">
                <summary className="cursor-pointer font-medium">
                  View {parsed.duplicates.length} duplicate Question No.(s) — these will NOT be uploaded
                </summary>
                <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
                  {parsed.duplicates.slice(0, 100).map((d, i) => (
                    <li key={i}>{d.module} — Question No. {d.questionNo}: {d.questionText.slice(0, 60)}...</li>
                  ))}
                </ul>
              </details>
            )}

            <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="p-2">Module</th>
                    <th className="p-2">Topic</th>
                    <th className="p-2">Difficulty</th>
                    <th className="p-2">Question</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="p-2">{r.module}</td>
                      <td className="p-2">{r.feature}</td>
                      <td className="p-2 capitalize">{r.difficulty}</td>
                      <td className="max-w-xs truncate p-2">{r.questionText}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.rows.length > 50 && <p className="p-2 text-center text-xs text-slate-400">+{parsed.rows.length - 50} more...</p>}
            </div>

            <button className="btn-primary w-full" onClick={handleImport} disabled={parsed.rows.length === 0}>
              Import {parsed.rows.length} questions
            </button>
          </div>
        )}

        {importing && (
          <div className="space-y-3 py-4">
            <div className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Importing in batches of 200...
              </span>
              <span className="font-medium">{progress.done} / {progress.total}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
              <div className="h-full bg-brand-600 transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="text-center text-xs text-slate-400">{progressPct}% — don't close this window</p>
          </div>
        )}

        {summary && (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-2 text-center">
              {summary.failed === 0 ? (
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              ) : (
                <AlertTriangle className="h-8 w-8 text-amber-500" />
              )}
              <p className="font-medium">Import finished</p>
            </div>

            <div className="grid grid-cols-4 gap-3 text-center">
              <SummaryStat label="Imported" value={summary.imported} color="text-emerald-600" />
              <SummaryStat label="Skipped" value={parsed?.skippedCount ?? 0} color="text-slate-400" />
              <SummaryStat label="Failed" value={summary.failed} color="text-red-500" />
              <SummaryStat label="Duplicates" value={(parsed?.duplicates.length ?? 0) + summary.duplicatesSkipped} color="text-amber-500" />
            </div>

            {summary.failedBatches.length > 0 && (
              <div className="rounded-lg bg-red-50 p-3 text-xs dark:bg-red-900/20">
                <p className="mb-1 font-medium">
                  {summary.failedBatches.length} batch(es) failed after 3 retries each — re-upload the same file to retry just those rows (already-imported rows won't be duplicated).
                </p>
                <ul className="space-y-0.5">
                  {summary.failedBatches.map((b, i) => (
                    <li key={i}>Rows {b.startIndex + 1}–{b.startIndex + b.count}: {b.error}</li>
                  ))}
                </ul>
              </div>
            )}

            <button className="btn-secondary w-full" onClick={reset}>Import another file</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <p className={`text-xl font-semibold ${color}`}>{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
