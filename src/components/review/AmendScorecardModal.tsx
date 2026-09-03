"use client";

import { useState, useEffect } from "react";
import { amendScorecard, QuestionAmendmentInput } from "@/lib/attempts";
import type { ExamAttempt, KnowledgeGapCategory, Question } from "@/types";
import { Modal } from "@/components/ui/Primitives";
import { QuestionContent } from "@/components/questions/QuestionContent";
import { AnswerDisplay } from "@/components/questions/AnswerDisplay";
import { AlertCircle, CheckCircle2, History, Loader2, ShieldAlert } from "lucide-react";

const KNOWLEDGE_GAPS: KnowledgeGapCategory[] = [
  "Product Knowledge",
  "Workflow",
  "Navigation",
  "Troubleshooting",
  "Insurance",
  "Reporting",
  "Clinical",
  "Scheduler",
  "Communication",
  "Compliance",
  "Other",
];

interface AmendScorecardModalProps {
  open: boolean;
  onClose: () => void;
  attempt: ExamAttempt;
  reviewerId: string;
  onAmended: (updated: ExamAttempt) => void;
  questionSnapshots?: Record<string, Question>;
}

export function AmendScorecardModal({
  open,
  onClose,
  attempt,
  reviewerId,
  onAmended,
  questionSnapshots,
}: AmendScorecardModalProps) {
  const [reason, setReason] = useState("");
  const [amendments, setAmendments] = useState<
    Record<
      string,
      {
        marks: number;
        comments: string;
        knowledgeGapCategory?: KnowledgeGapCategory;
      }
    >
  >(() => {
    const initial: Record<
      string,
      {
        marks: number;
        comments: string;
        knowledgeGapCategory?: KnowledgeGapCategory;
      }
    > = {};
    attempt.answers.forEach((ans) => {
      initial[ans.questionId] = {
        marks: ans.marks ?? 0,
        comments: ans.comments ?? "",
        knowledgeGapCategory: ans.knowledgeGapCategory,
      };
    });
    return initial;
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Synchronize amendments state whenever modal opens or attempt changes
  useEffect(() => {
    if (!open || !attempt) return;
    const initial: Record<
      string,
      {
        marks: number;
        comments: string;
        knowledgeGapCategory?: KnowledgeGapCategory;
      }
    > = {};
    attempt.answers.forEach((ans) => {
      initial[ans.questionId] = {
        marks: ans.marks ?? 0,
        comments: ans.comments ?? "",
        knowledgeGapCategory: ans.knowledgeGapCategory,
      };
    });
    setAmendments(initial);
    setReason("");
    setError("");
    setSuccess(false);
  }, [open, attempt]);

  // Recalculated total
  const amendedTotal = attempt.answers.reduce((sum, ans) => {
    const state = amendments[ans.questionId];
    return sum + (state ? state.marks : ans.marks ?? 0);
  }, 0);

  const maxTotal = attempt.maxTotalMarks ?? attempt.answers.reduce((sum, a) => sum + a.maxMarks, 0);

  async function handleCommit() {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError("Please provide a reason for amending this scorecard.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const amendmentList: QuestionAmendmentInput[] = attempt.answers.map((ans) => {
        const state = amendments[ans.questionId] || {
          marks: ans.marks ?? 0,
          comments: ans.comments ?? "",
          knowledgeGapCategory: ans.knowledgeGapCategory,
        };
        return {
          questionId: ans.questionId,
          marks: typeof state.marks === "number" ? state.marks : (ans.marks ?? 0),
          comments: state.comments ?? "",
          knowledgeGapCategory: state.knowledgeGapCategory,
        };
      });

      const updated = await amendScorecard(
        attempt.id,
        amendmentList,
        reviewerId || "auditor",
        trimmedReason
      );

      setSuccess(true);
      setTimeout(() => {
        onAmended(updated);
        onClose();
      }, 1000);
    } catch (err) {
      console.error("Failed to amend scorecard:", err);
      setError(err instanceof Error ? err.message : "Failed to amend scorecard. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Amend Scorecard — Attempt #${attempt.attemptNumber}`}
      wide
    >
      <div className="space-y-4">
        {/* Audit Guidance Header */}
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">Explicit Scorecard Amendment</p>
            <p className="mt-0.5 text-amber-800 dark:text-amber-400">
              This attempt has already been finalized. Amendments append to each question&apos;s audit trail
              without altering attempt identity or corrupting historical question analytics.
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>Scorecard amended successfully. Recalculated total saved.</span>
          </div>
        )}

        {/* Reason for Amendment */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            Reason for Amendment <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className="input text-sm"
            placeholder="e.g. Candidate provided valid alternative billing rationale under review dispute"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={saving || success}
          />
        </div>

        {/* Live Score Preview */}
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/50">
          <span className="text-slate-500">Score Projection:</span>
          <div className="flex items-center gap-2 font-mono">
            <span className="text-slate-400 line-through">
              Original: {attempt.totalMarks}/{maxTotal}
            </span>
            <span className="font-bold text-brand-600 dark:text-brand-400">
              Amended: {amendedTotal}/{maxTotal} ({maxTotal > 0 ? Math.round((amendedTotal / maxTotal) * 100) : 0}%)
            </span>
          </div>
        </div>

        {/* Question Amendment Rows */}
        <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
          {attempt.answers.map((ans, idx) => {
            const q = ans.questionSnapshot ?? questionSnapshots?.[ans.questionId];
            const questionContent = q?.questionText || `Question #${idx + 1}`;
            const qState = amendments[ans.questionId] || { marks: ans.marks ?? 0, comments: ans.comments ?? "" };

            return (
              <div
                key={ans.questionId}
                className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-700"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <span className="font-mono font-bold text-slate-500">Q#{idx + 1}</span>
                    <QuestionContent
                      content={questionContent}
                      className="mt-1 font-medium text-slate-800 dark:text-slate-200"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <label className="text-[11px] font-semibold text-slate-500">Marks:</label>
                    <input
                      type="number"
                      min={0}
                      max={ans.maxMarks}
                      className="input h-7 w-16 px-1.5 text-center text-xs font-bold"
                      value={qState.marks}
                      onChange={(e) => {
                        const val = Math.max(0, Math.min(ans.maxMarks, Number(e.target.value) || 0));
                        setAmendments((prev) => ({
                          ...prev,
                          [ans.questionId]: {
                            ...(prev[ans.questionId] || { marks: 0, comments: ans.comments ?? "" }),
                            marks: val,
                          },
                        }));
                      }}
                      disabled={saving || success}
                    />
                    <span className="text-slate-400">/ {ans.maxMarks}</span>
                  </div>
                </div>

                {/* Candidate Answer */}
                <div className="mb-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Candidate Response:
                  </span>
                  {q ? (
                    <AnswerDisplay question={q} agentAnswer={ans.agentAnswer} />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm">{ans.agentAnswer || "(no answer)"}</p>
                  )}
                </div>

                {/* Comments */}
                <div className="space-y-1.5">
                  <input
                    type="text"
                    className="input text-xs"
                    placeholder="Updated feedback notes for candidate..."
                    value={qState.comments}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAmendments((prev) => ({
                        ...prev,
                        [ans.questionId]: {
                          ...(prev[ans.questionId] || { marks: ans.marks ?? 0, comments: "" }),
                          comments: val,
                        },
                      }));
                    }}
                    disabled={saving || success}
                  />

                  {/* Knowledge gap dropdown if marks lost */}
                  {qState.marks < ans.maxMarks && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-500">Knowledge Gap:</span>
                      <select
                        className="input h-7 text-xs flex-1"
                        value={qState.knowledgeGapCategory || ""}
                        onChange={(e) => {
                          const val = (e.target.value || undefined) as KnowledgeGapCategory | undefined;
                          setAmendments((prev) => ({
                            ...prev,
                            [ans.questionId]: {
                              ...(prev[ans.questionId] || { marks: ans.marks ?? 0, comments: ans.comments ?? "" }),
                              knowledgeGapCategory: val,
                            },
                          }));
                        }}
                        disabled={saving || success}
                      >
                        <option value="">None specified</option>
                        {KNOWLEDGE_GAPS.map((gap) => (
                          <option key={gap} value={gap}>
                            {gap}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Score History */}
                  {ans.scoreHistory && ans.scoreHistory.length > 0 && (
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-400">
                      <History className="h-3 w-3" />
                      <span>{ans.scoreHistory.length} prior revision(s) recorded in audit history.</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5"
            onClick={handleCommit}
            disabled={saving || success}
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving Amendment...
              </>
            ) : (
              "Commit Amendment"
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}