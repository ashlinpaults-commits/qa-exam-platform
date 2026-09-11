"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getExam } from "@/lib/exams";
import {
  startAttempt,
  saveAllAnswers,
  verifyAttemptAnswers,
  submitAttempt,
  getAttempt,
} from "@/lib/attempts";
import { useAuth } from "@/context/AuthContext";
import type { Exam, Question, ExamAttempt } from "@/types";
import { AnswerInput } from "@/components/questions/AnswerInput";
import { QuestionContent } from "@/components/questions/QuestionContent";
import {
  PreSubmissionModal,
  type SubmitStage,
} from "./PreSubmissionModal";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Check,
  AlertTriangle,
  Send,
} from "lucide-react";

export function TakeExam({ examId }: { examId: string }) {
  const { profile } = useAuth();
  const router = useRouter();
  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  // Pre-submission review modal state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [submitStage, setSubmitStage] = useState<SubmitStage>("idle");
  const [submitError, setSubmitError] = useState("");

  // Refs to prevent closure staleness and race conditions
  const answersRef = useRef<Record<string, string>>({});
  const dirtyKeysRef = useRef<Set<string>>(new Set());
  const lastSavedAnswerRef = useRef<Record<string, string>>({});
  const saveInProgressRef = useRef(false);
  const flushRequestedRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Synchronize answersRef with answers state
  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // Load Exam and Attempt
  useEffect(() => {
    if (!profile?.uid) return;
    let cancelled = false;

    (async () => {
      try {
        console.debug("[TakeExam] Loading exam", { examId, agentId: profile.uid });
        const e = await getExam(examId);
        if (cancelled) return;
        if (!e) throw new Error("This exam is no longer available.");
        setExam(e);

        const attemptId = await startAttempt(e, profile.uid);
        if (cancelled) return;
        const a = await getAttempt(attemptId);
        if (cancelled) return;
        setAttempt(a);

        if (a) {
          console.debug("[TakeExam] Attempt loaded/started", {
            examId,
            attemptId: a.id,
            attemptNumber: a.attemptNumber,
            status: a.status,
          });

          const qs = a.answers
            .map((ans) => ans.questionSnapshot ?? e.questionSnapshots?.[ans.questionId])
            .filter(Boolean) as Question[];
          if (qs.length !== a.answers.length) {
            throw new Error("This exam is missing its safe question content. Ask an auditor to republish it.");
          }
          setQuestions(qs);

          const initial: Record<string, string> = {};
          a.answers.forEach((ans) => {
            const val = ans.agentAnswer || "";
            initial[ans.questionId] = val;
            lastSavedAnswerRef.current[ans.questionId] = val;
          });
          setAnswers(initial);
          answersRef.current = initial;
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load attempt", err);
        setError(err instanceof Error ? err.message : "Couldn't load this exam. Please retry.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [examId, profile?.uid]);

  // Serialized atomic flush of all dirty answers
  const flushDirtyAnswers = useCallback(async (): Promise<boolean> => {
    if (!attempt || dirtyKeysRef.current.size === 0) return true;
    if (saveInProgressRef.current) {
      flushRequestedRef.current = true;
      return true;
    }

    saveInProgressRef.current = true;
    setSaveStatus("saving");

    const toSave: Record<string, string> = {};
    dirtyKeysRef.current.forEach((qid) => {
      toSave[qid] = answersRef.current[qid] ?? "";
    });

    try {
      await saveAllAnswers(attempt.id, toSave);
      Object.entries(toSave).forEach(([qid, val]) => {
        if (answersRef.current[qid] === val) {
          dirtyKeysRef.current.delete(qid);
        }
        lastSavedAnswerRef.current[qid] = val;
      });
      setSaveStatus("saved");
      return true;
    } catch (err) {
      console.error("Failed to save answers", err);
      setSaveStatus("error");
      return false;
    } finally {
      saveInProgressRef.current = false;
      if (flushRequestedRef.current) {
        flushRequestedRef.current = false;
        flushDirtyAnswers();
      }
    }
  }, [attempt]);

  // Clean up debounce timer on unmount and perform final synchronous flush if needed
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleAnswerChange = (qId: string, val: string) => {
    dirtyKeysRef.current.add(qId);
    setAnswers((prev) => {
      const next = { ...prev, [qId]: val };
      answersRef.current = next;
      return next;
    });

    // Schedule debounced flush (800ms)
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      flushDirtyAnswers();
    }, 800);
  };

  // Immediate flush before switching questions
  const handleNavigate = (newIndex: number) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (dirtyKeysRef.current.size > 0) {
      flushDirtyAnswers();
    }
    setIndex(newIndex);
  };

  // Pre-submission review modal trigger
  const handleOpenSubmitReview = async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (dirtyKeysRef.current.size > 0) {
      await flushDirtyAnswers();
    }
    setSubmitError("");
    setShowReviewModal(true);
  };

  // Confirmed final submit sequence: Save -> Verify -> Submit
  const handleFinalSubmit = async () => {
    if (!attempt || submitting) return;
    setSubmitting(true);
    setSubmitError("");

    try {
      // 1. FINAL PERSISTENCE of latest UI answer state
      setSubmitStage("saving");
      await saveAllAnswers(attempt.id, answersRef.current);

      Object.entries(answersRef.current).forEach(([qid, val]) => {
        lastSavedAnswerRef.current[qid] = val;
        dirtyKeysRef.current.delete(qid);
      });
      setSaveStatus("saved");

      // 2. PERSISTENCE VERIFICATION
      setSubmitStage("verifying");
      const verification = await verifyAttemptAnswers(attempt.id, answersRef.current);
      if (!verification.verified) {
        throw new Error(
          `Some answers could not be verified in the database (${verification.missingQuestionIds.length} question(s) unconfirmed). Please check your connection and try again.`
        );
      }

      // 3. ATOMIC SUBMISSION STATUS TRANSITION
      setSubmitStage("submitting");
      await submitAttempt(attempt.id, attempt.startedAt);

      setShowReviewModal(false);
      router.push("/agent/dashboard");
    } catch (err) {
      console.error("Failed to finalize submission", err);
      const msg = err instanceof Error ? err.message : "Submission failed. Please check your network and try again.";
      setSubmitError(msg);
      setSubmitStage("idle");
      setSubmitting(false);
    }
  };

  if (loading || !exam || questions.length === 0) {
    if (error) {
      return (
        <div className="mx-auto max-w-2xl rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      );
    }
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  const current = questions[index];
  const progress = ((index + 1) / questions.length) * 100;

  return (
    <div className="mx-auto max-w-2xl">
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Progress & Autosave Status Header */}
      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between text-sm">
          <span className="text-slate-500">
            Question {index + 1} of {questions.length}
          </span>

          {/* Unobtrusive Save Indicator */}
          <div className="flex items-center">
            {saveStatus === "saving" && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving...
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                All changes saved
              </span>
            )}
            {saveStatus === "error" && (
              <span className="flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                Changes not saved
                <button
                  type="button"
                  onClick={() => flushDirtyAnswers()}
                  className="ml-1 font-semibold underline hover:text-rose-700"
                >
                  Retry
                </button>
              </span>
            )}
            {saveStatus === "idle" && (
              <span className="text-xs text-slate-400">All changes saved</span>
            )}
          </div>
        </div>

        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Question Card */}
      <div className="card p-6">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
              {current.module} · {current.topic || current.feature}
            </p>
            {attempt && attempt.attemptNumber > 1 && (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                Reattempt (Attempt {attempt.attemptNumber})
              </span>
            )}
          </div>
          <span className="text-xs font-medium text-slate-400">
            Question {index + 1} of {questions.length}
          </span>
        </div>

        <div className="mb-6 border-b border-slate-100 pb-5 dark:border-slate-800">
          <QuestionContent content={current.questionText} className="text-base text-slate-900 dark:text-slate-100" />
        </div>

        <AnswerInput
          question={current}
          value={answers[current.id] ?? ""}
          onChange={(v) => handleAnswerChange(current.id, v)}
        />
      </div>

      {/* Navigation and Submit Buttons */}
      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={index === 0}
          onClick={() => handleNavigate(index - 1)}
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> Previous
        </button>

        <div className="flex items-center gap-2">
          {index < questions.length - 1 ? (
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => handleNavigate(index + 1)}
            >
              Next <ChevronRight className="ml-1 h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={handleOpenSubmitReview}
              disabled={submitting}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              Submit Exam
            </button>
          )}
        </div>
      </div>

      {/* Pre-Submission Review Modal */}
      <PreSubmissionModal
        open={showReviewModal}
        questions={questions}
        answers={answers}
        onClose={() => {
          if (!submitting) setShowReviewModal(false);
        }}
        onConfirmSubmit={handleFinalSubmit}
        submitStage={submitStage}
        errorMessage={submitError}
        onJumpToQuestion={(targetIdx) => handleNavigate(targetIdx)}
      />
    </div>
  );
}
