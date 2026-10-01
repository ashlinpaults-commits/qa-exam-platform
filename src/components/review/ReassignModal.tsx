"use client";

import { useState, useMemo, useRef } from "react";
import { Modal } from "@/components/ui/Primitives";
import { reassignExamFromAttempt } from "@/lib/assignments";
import type { Exam, ExamAttempt, ExamAssignment, ReassignmentMode, Question } from "@/types";
import { Loader2, AlertCircle, CheckCircle2, Sparkles } from "lucide-react";

interface ReassignModalProps {
  open: boolean;
  onClose: () => void;
  exam: Exam;
  sourceAttempt: ExamAttempt;
  agentName?: string;
  auditorId: string;
  questionsMap?: Record<string, Question>;
  allAttempts?: ExamAttempt[];
  onSuccess: (assignment: ExamAssignment) => void;
}

export function ReassignModal({
  open,
  onClose,
  exam,
  sourceAttempt,
  agentName,
  auditorId,
  questionsMap = {},
  allAttempts = [],
  onSuccess,
}: ReassignModalProps) {
  const [mode, setMode] = useState<ReassignmentMode>("all");
  const [customQuestionIds, setCustomQuestionIds] = useState<Set<string>>(
    new Set((exam.questions || []).map((q) => q.questionId))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const isSubmittingRef = useRef(false);

  // Identify wrong answers from source attempt
  const wrongAnswers = useMemo(() => {
    return (sourceAttempt.answers || []).filter(
      (a) => a.marks === undefined || a.marks < a.maxMarks
    );
  }, [sourceAttempt.answers]);

  const questionCount = useMemo(() => {
    if (mode === "all") return (exam.questions || []).length;
    if (mode === "wrong_only") return wrongAnswers.length;
    return customQuestionIds.size;
  }, [mode, exam.questions, wrongAnswers.length, customQuestionIds.size]);

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (mode === "wrong_only" && wrongAnswers.length === 0) return false;
    if (mode === "custom" && customQuestionIds.size === 0) return false;
    return questionCount > 0;
  }, [submitting, mode, wrongAnswers.length, customQuestionIds.size, questionCount]);

  async function handleReassign() {
    // Idempotency: prevent double-clicks
    if (isSubmittingRef.current || !canSubmit) return;

    try {
      isSubmittingRef.current = true;
      setSubmitting(true);
      setError("");

      const customIds = mode === "custom" ? Array.from(customQuestionIds) : undefined;

      const agentAttempts = (allAttempts || []).filter((a) => a.agentId === sourceAttempt.agentId);
      const highestAttemptNum = Math.max(
        sourceAttempt.attemptNumber || 0,
        ...agentAttempts.map((a) => a.attemptNumber || 0)
      );
      const targetAttemptNumber = highestAttemptNum + 1;

      const assignment = await reassignExamFromAttempt({
        exam,
        agentId: sourceAttempt.agentId,
        sourceAttempt,
        mode,
        customQuestionIds: customIds,
        assignedBy: auditorId,
        targetAttemptNumber,
      });

      onSuccess(assignment);
      onClose();
    } catch (err: any) {
      console.error("[ReassignModal] Error during reassignment:", err);
      setError(err.message || "Failed to reassign exam. Please retry.");
    } finally {
      setSubmitting(false);
      isSubmittingRef.current = false;
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={`Reassign Exam — ${exam.name}`}
    >
      <div className="space-y-4">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Target Agent:{" "}
          <strong className="text-slate-800 dark:text-slate-200">
            {agentName || sourceAttempt.agentId}
          </strong>{" "}
          · Source Attempt: #{sourceAttempt.attemptNumber}
        </p>

        {error && (
          <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Reassignment Options */}
        <div className="space-y-2.5">
          {/* Option A: All Questions */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
              mode === "all"
                ? "border-brand-600 bg-brand-50/40 ring-1 ring-brand-600 dark:bg-brand-950/20"
                : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
            }`}
          >
            <input
              type="radio"
              name="reassign_mode"
              className="mt-1"
              checked={mode === "all"}
              onChange={() => setMode("all")}
              disabled={submitting}
            />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  All Questions
                </span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  {(exam.questions || []).length} questions
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Reassigns all questions from the original exam. Creates a new actionable assignment.
              </p>
            </div>
          </label>

          {/* Option B: Wrong Answers Only */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
              wrongAnswers.length === 0 ? "opacity-60 cursor-not-allowed" : ""
            } ${
              mode === "wrong_only"
                ? "border-brand-600 bg-brand-50/40 ring-1 ring-brand-600 dark:bg-brand-950/20"
                : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
            }`}
          >
            <input
              type="radio"
              name="reassign_mode"
              className="mt-1"
              checked={mode === "wrong_only"}
              onChange={() => setMode("wrong_only")}
              disabled={submitting || wrongAnswers.length === 0}
            />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  Wrong Answers Only
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-semibold ${
                    wrongAnswers.length > 0
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                      : "bg-slate-100 text-slate-400 dark:bg-slate-700"
                  }`}
                >
                  {wrongAnswers.length} eligible
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Targets only the questions where the agent lost marks in the previous attempt.
              </p>
              {wrongAnswers.length === 0 && (
                <p className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Agent scored 100% on all questions. No incorrect questions found.
                </p>
              )}
            </div>
          </label>

          {/* Option C: Custom Assignment */}
          <label
            className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ${
              mode === "custom"
                ? "border-brand-600 bg-brand-50/40 ring-1 ring-brand-600 dark:bg-brand-950/20"
                : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
            }`}
          >
            <input
              type="radio"
              name="reassign_mode"
              className="mt-1"
              checked={mode === "custom"}
              onChange={() => setMode("custom")}
              disabled={submitting}
            />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Custom Assignment
                </span>
                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                  {customQuestionIds.size} selected
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                Manually pick specific questions from the exam.
              </p>
            </div>
          </label>
        </div>

        {/* Custom Question Selection Box */}
        {mode === "custom" && (
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-medium">Select questions:</span>
              <div className="flex gap-2 font-medium">
                <button
                  type="button"
                  className="text-brand-600 hover:underline"
                  onClick={() =>
                    setCustomQuestionIds(
                      new Set((exam.questions || []).map((q) => q.questionId))
                    )
                  }
                >
                  Select all
                </button>
                <span>·</span>
                <button
                  type="button"
                  className="text-brand-600 hover:underline"
                  onClick={() => setCustomQuestionIds(new Set())}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
              {(exam.questions || []).map((qRef, idx) => {
                const qId = qRef.questionId;
                const q = questionsMap[qId] || exam.questionSnapshots?.[qId];
                const prevAns = sourceAttempt.answers?.find((a) => a.questionId === qId);
                const isChecked = customQuestionIds.has(qId);

                return (
                  <label
                    key={qId}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2 text-xs transition-colors ${
                      isChecked
                        ? "border-brand-300 bg-brand-50/50 dark:border-brand-800 dark:bg-brand-950/30"
                        : "border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={isChecked}
                      onChange={() => {
                        setCustomQuestionIds((prev) => {
                          const next = new Set(prev);
                          next.has(qId) ? next.delete(qId) : next.add(qId);
                          return next;
                        });
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between text-slate-500">
                        <span className="font-mono font-bold">Q{idx + 1}</span>
                        {prevAns && (
                          <span
                            className={`font-semibold ${
                              (prevAns.marks ?? 0) >= prevAns.maxMarks
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-amber-600 dark:text-amber-400"
                            }`}
                          >
                            Prev: {prevAns.marks ?? 0} / {prevAns.maxMarks}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-slate-700 dark:text-slate-300">
                        {q?.questionText || `Question ${idx + 1}`}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer: Summary and Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Questions: <span className="text-brand-600 font-bold">{questionCount}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex items-center gap-1.5 text-xs"
              onClick={handleReassign}
              disabled={!canSubmit}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Reassigning...
                </>
              ) : (
                "Reassign"
              )}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
