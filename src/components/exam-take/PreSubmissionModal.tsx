"use client";

import { useMemo } from "react";
import type { Question } from "@/types";
import { Modal } from "@/components/ui/Primitives";
import { CheckCircle2, AlertTriangle, Loader2, ArrowLeft, ArrowRight, Send } from "lucide-react";

export type SubmitStage = "idle" | "saving" | "verifying" | "submitting";

export function isQuestionAnswered(question: Question, value?: string): boolean {
  if (value === undefined || value === null) return false;
  const trimmed = value.trim();

  switch (question.type) {
    case "mcq":
      return trimmed.length > 0 && !isNaN(Number(trimmed));

    case "true_false":
      return trimmed === "True" || trimmed === "False";

    case "drag_drop_order":
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) && parsed.length > 0;
      } catch {
        return false;
      }

    case "descriptive":
    case "case_study":
    case "image_based":
    default:
      return trimmed.length > 0;
  }
}

interface PreSubmissionModalProps {
  open: boolean;
  questions: Question[];
  answers: Record<string, string>;
  onClose: () => void;
  onConfirmSubmit: () => void;
  submitStage: SubmitStage;
  errorMessage?: string;
  onJumpToQuestion?: (index: number) => void;
}

export function PreSubmissionModal({
  open,
  questions,
  answers,
  onClose,
  onConfirmSubmit,
  submitStage,
  errorMessage,
  onJumpToQuestion,
}: PreSubmissionModalProps) {
  const isBusy = submitStage !== "idle";

  const questionStatuses = useMemo(() => {
    return questions.map((q, idx) => {
      const answered = isQuestionAnswered(q, answers[q.id]);
      const numStr = String(idx + 1).padStart(2, "0");
      return {
        question: q,
        index: idx,
        numStr,
        answered,
      };
    });
  }, [questions, answers]);

  const unansweredItems = useMemo(() => {
    return questionStatuses.filter((item) => !item.answered);
  }, [questionStatuses]);

  const allAnswered = unansweredItems.length === 0;

  const getStageLabel = () => {
    switch (submitStage) {
      case "saving":
        return "Saving final answers...";
      case "verifying":
        return "Verifying answers in database...";
      case "submitting":
        return "Submitting exam...";
      default:
        return "";
    }
  };

  return (
    <Modal
      open={open}
      onClose={isBusy ? () => {} : onClose}
      title="Review Your Answers"
      wide
    >
      <div className="space-y-4 text-slate-800 dark:text-slate-200">
        {/* Error Banner if final save or verification fails */}
        {errorMessage && (
          <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
            <div>
              <p className="font-semibold">Submission Paused</p>
              <p className="mt-0.5">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* Overall Status Banner */}
        {allAnswered ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="font-semibold">All questions have an answer.</p>
              <p className="mt-0.5 text-slate-600 dark:text-slate-400">
                You have provided answers for all {questions.length} question(s). Click &quot;Proceed to Submit&quot; to finalize.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div>
              <p className="font-semibold">
                {unansweredItems.length} question{unansweredItems.length === 1 ? " is" : "s are"} unanswered.
              </p>
              <p className="mt-0.5">
                Unanswered:{" "}
                <span className="font-mono font-semibold">
                  {unansweredItems.map((u) => u.numStr).join(", ")}
                </span>
              </p>
              <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-400">
                You can return to the exam to finish them or choose to submit anyway.
              </p>
            </div>
          </div>
        )}

        {/* Question-by-Question Status Checklist */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-900/20 overflow-hidden">
          <div className="grid grid-cols-12 gap-2 border-b border-slate-200 bg-slate-100/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/60">
            <div className="col-span-2 sm:col-span-1">No.</div>
            <div className="col-span-7 sm:col-span-8">Topic / Focus</div>
            <div className="col-span-3 text-right">Status</div>
          </div>

          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
            {questionStatuses.map((item) => (
              <div
                key={item.question.id}
                onClick={
                  !isBusy && onJumpToQuestion
                    ? () => {
                        onJumpToQuestion(item.index);
                        onClose();
                      }
                    : undefined
                }
                className={`grid grid-cols-12 gap-2 items-center px-4 py-2.5 transition ${
                  !isBusy && onJumpToQuestion ? "cursor-pointer hover:bg-slate-100/70 dark:hover:bg-slate-800/50" : ""
                } ${!item.answered ? "bg-amber-50/20 dark:bg-amber-950/10" : ""}`}
              >
                <div className="col-span-2 sm:col-span-1 font-mono font-bold text-slate-700 dark:text-slate-300">
                  {item.numStr}
                </div>
                <div className="col-span-7 sm:col-span-8 truncate text-slate-600 dark:text-slate-400">
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {item.question.module}
                  </span>
                  {(item.question.topic || item.question.feature) && (
                    <span className="text-slate-400 ml-1.5">
                      · {item.question.topic || item.question.feature}
                    </span>
                  )}
                </div>
                <div className="col-span-3 text-right">
                  {item.answered ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-md text-[11px]">
                      <CheckCircle2 className="h-3 w-3" /> Answered
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-md text-[11px]">
                      <AlertTriangle className="h-3 w-3" /> Not answered
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* In-Progress Saving / Verifying / Submitting Indicator */}
        {isBusy && (
          <div className="flex items-center justify-center gap-2.5 rounded-xl border border-brand-200 bg-brand-50/70 p-3 text-xs text-brand-800 dark:border-brand-900/50 dark:bg-brand-950/30 dark:text-brand-300 font-medium">
            <Loader2 className="h-4 w-4 animate-spin text-brand-600 dark:text-brand-400" />
            <span>{getStageLabel()}</span>
          </div>
        )}

        {/* Modal Action Buttons */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          {/* Back / Return button */}
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={onClose}
            disabled={isBusy}
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            {allAnswered ? "Go Back" : "Return to Exam"}
          </button>

          {/* Submit button */}
          <button
            type="button"
            onClick={onConfirmSubmit}
            disabled={isBusy}
            className={`text-xs ${
              allAnswered
                ? "btn-primary"
                : "rounded-xl bg-amber-600 px-4 py-2 font-medium text-white shadow-sm hover:bg-amber-700 disabled:opacity-50"
            }`}
          >
            {isBusy ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Processing...
              </>
            ) : allAnswered ? (
              <>
                Proceed to Submit
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </>
            ) : (
              <>
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Submit Anyway
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
