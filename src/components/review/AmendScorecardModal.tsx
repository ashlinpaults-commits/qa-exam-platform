"use client";

import { useState, useEffect } from "react";
import { amendScorecard, QuestionAmendmentInput } from "@/lib/attempts";
import { saveAiReviewToAttempt } from "@/lib/aiReview";
import { stripUndefined } from "@/lib/questions";
import { auth } from "@/lib/firebase";
import type {
  ExamAttempt,
  KnowledgeGapCategory,
  Question,
  AttemptAiReview,
  QuestionAiReview,
} from "@/types";
import { Modal } from "@/components/ui/Primitives";
import { QuestionContent } from "@/components/questions/QuestionContent";
import { AnswerDisplay } from "@/components/questions/AnswerDisplay";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  History,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";

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
        aiSuggestedScore?: number;
      }
    >
  >(() => {
    const initial: Record<
      string,
      {
        marks: number;
        comments: string;
        knowledgeGapCategory?: KnowledgeGapCategory;
        aiSuggestedScore?: number;
      }
    > = {};
    attempt.answers.forEach((ans) => {
      initial[ans.questionId] = {
        marks: ans.marks ?? 0,
        comments: ans.comments ?? "",
        knowledgeGapCategory: ans.knowledgeGapCategory,
        aiSuggestedScore: ans.aiSuggestedScore,
      };
    });
    return initial;
  });

  // AI Review state
  const [currentAiReview, setCurrentAiReview] = useState<AttemptAiReview | null>(
    () => attempt.aiReview || null
  );
  const [runningAi, setRunningAi] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Synchronize state whenever modal opens or attempt changes
  useEffect(() => {
    if (!open || !attempt) return;
    const initial: Record<
      string,
      {
        marks: number;
        comments: string;
        knowledgeGapCategory?: KnowledgeGapCategory;
        aiSuggestedScore?: number;
      }
    > = {};
    attempt.answers.forEach((ans) => {
      initial[ans.questionId] = {
        marks: ans.marks ?? 0,
        comments: ans.comments ?? "",
        knowledgeGapCategory: ans.knowledgeGapCategory,
        aiSuggestedScore: ans.aiSuggestedScore,
      };
    });
    setAmendments(initial);
    setCurrentAiReview(attempt.aiReview || null);
    setReason("");
    setError("");
    setAiError(null);
    setSuccess(false);
  }, [open, attempt]);

  // Recalculated total
  const amendedTotal = attempt.answers.reduce((sum, ans) => {
    const state = amendments[ans.questionId];
    return sum + (state ? state.marks : ans.marks ?? 0);
  }, 0);

  const maxTotal =
    attempt.maxTotalMarks ?? attempt.answers.reduce((sum, a) => sum + a.maxMarks, 0);

  // Map of question reviews for quick lookup
  const aiReviewsMap = new Map<string, QuestionAiReview>();
  (currentAiReview?.questionReviews || []).forEach((qr) => {
    aiReviewsMap.set(qr.questionId, qr);
  });

  // Run or regenerate AI Review in amendment mode
  async function handleRunAiReview(forceRegenerate = false) {
    setRunningAi(true);
    setAiError(null);
    setError("");

    try {
      const idToken = await auth.currentUser?.getIdToken(true);
      const res = await fetch("/api/ai/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({
          attemptId: attempt.id,
          forceRegenerate,
          questions: attempt.answers
            .map((a) => a.questionSnapshot || questionSnapshots?.[a.questionId])
            .filter(Boolean),
          attempt,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to generate AI review");
      }

      const data = await res.json();
      if (data.aiReview) {
        setCurrentAiReview(data.aiReview);
        // Persist AI review asynchronously
        try {
          await saveAiReviewToAttempt(attempt.id, data.aiReview);
        } catch (saveErr) {
          console.warn("[AmendScorecardModal] Failed to persist AI review:", saveErr);
        }
      }
    } catch (err: any) {
      console.error("[AmendScorecardModal] AI Review error:", err);
      setAiError(
        err.message ||
          "AI review service temporarily unavailable. Manual amendment remains fully accessible."
      );
    } finally {
      setRunningAi(false);
    }
  }

  // One-click: Accept All AI Suggested Scores
  function handleAcceptAllAi() {
    if (!currentAiReview?.questionReviews) return;
    setAmendments((prev) => {
      const next = { ...prev };
      for (const qr of currentAiReview.questionReviews) {
        const existing = next[qr.questionId] || {
          marks: 0,
          comments: "",
          knowledgeGapCategory: undefined,
        };
        next[qr.questionId] = {
          ...existing,
          marks: qr.aiSuggestedScore,
          aiSuggestedScore: qr.aiSuggestedScore,
        };
      }
      return next;
    });
  }

  // One-click: Accept single question AI Suggested Score
  function handleAcceptSingleAi(questionId: string, aiScore: number) {
    setAmendments((prev) => {
      const existing = prev[questionId] || {
        marks: 0,
        comments: "",
        knowledgeGapCategory: undefined,
      };
      return {
        ...prev,
        [questionId]: {
          ...existing,
          marks: aiScore,
          aiSuggestedScore: aiScore,
        },
      };
    });
  }

  // Reset a question back to previous finalized score
  function handleResetToPrevious(questionId: string, prevScore: number) {
    setAmendments((prev) => {
      const existing = prev[questionId] || {
        marks: 0,
        comments: "",
        knowledgeGapCategory: undefined,
      };
      return {
        ...prev,
        [questionId]: {
          ...existing,
          marks: prevScore,
        },
      };
    });
  }

  // One-click: Accept AI & Finalize Amendment
  async function handleAcceptAiAndFinalize() {
    if (!currentAiReview?.questionReviews) {
      setError("No AI review available to accept.");
      return;
    }

    const defaultReason =
      reason.trim() || "Accepted AI review recommendations for scorecard amendment";

    setSaving(true);
    setError("");

    try {
      const amendmentList: QuestionAmendmentInput[] = attempt.answers.map((ans) => {
        const qr = currentAiReview.questionReviews.find((r) => r.questionId === ans.questionId);
        const marks = qr !== undefined ? qr.aiSuggestedScore : (amendments[ans.questionId]?.marks ?? ans.marks ?? 0);
        const state = amendments[ans.questionId];
        return stripUndefined({
          questionId: ans.questionId,
          marks: Math.max(0, Math.min(ans.maxMarks, marks)),
          comments: state?.comments ?? ans.comments ?? "",
          knowledgeGapCategory: marks < ans.maxMarks ? state?.knowledgeGapCategory : undefined,
          aiSuggestedScore: qr !== undefined ? qr.aiSuggestedScore : ans.aiSuggestedScore,
        });
      });

      const updated = await amendScorecard(
        attempt.id,
        amendmentList,
        reviewerId || "auditor",
        defaultReason,
        { aiReview: currentAiReview }
      );

      setSuccess(true);
      setTimeout(() => {
        onAmended(updated);
        onClose();
      }, 1000);
    } catch (err: any) {
      console.error("Failed to accept AI and finalize amendment:", err);
      setError(err instanceof Error ? err.message : "Failed to finalize amendment. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  // Manual Amendment Commit
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
          aiSuggestedScore: ans.aiSuggestedScore,
        };
        const qr = aiReviewsMap.get(ans.questionId);
        return stripUndefined({
          questionId: ans.questionId,
          marks: typeof state.marks === "number" ? state.marks : (ans.marks ?? 0),
          comments: state.comments ?? "",
          knowledgeGapCategory: state.knowledgeGapCategory,
          aiSuggestedScore: state.aiSuggestedScore ?? qr?.aiSuggestedScore ?? ans.aiSuggestedScore,
        });
      });

      const updated = await amendScorecard(
        attempt.id,
        amendmentList,
        reviewerId || "auditor",
        trimmedReason,
        { aiReview: currentAiReview || undefined }
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

        {/* AI REVIEW ACTION LAYER */}
        <div className="rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/70 to-purple-50/50 p-3 text-xs dark:border-indigo-900/50 dark:from-indigo-950/30 dark:to-purple-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    AI-Assisted Amendment Review
                  </span>
                  {currentAiReview?.status === "complete" ? (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" /> Ready
                    </span>
                  ) : runningAi ? (
                    <span className="inline-flex items-center gap-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                      <Loader2 className="h-3 w-3 animate-spin" /> Analyzing...
                    </span>
                  ) : currentAiReview?.status === "failed" ? (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      <AlertTriangle className="h-3 w-3" /> Unavailable
                    </span>
                  ) : null}
                </div>
                {currentAiReview?.status === "complete" && (
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    AI Suggested Total:{" "}
                    <strong className="text-indigo-600 dark:text-indigo-400">
                      {currentAiReview.overallSuggestedPercentage}%
                    </strong>{" "}
                    ({currentAiReview.overallSuggestedScore} / {currentAiReview.maxPossibleScore} marks)
                  </p>
                )}
              </div>
            </div>

            {/* AI Control Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              {currentAiReview?.status === "complete" ? (
                <>
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-1 text-[11px] font-medium text-indigo-700 hover:text-indigo-800 dark:text-indigo-300"
                    onClick={handleAcceptAllAi}
                    disabled={saving}
                  >
                    <Sparkles className="h-3 w-3" /> Accept All AI Scores
                  </button>
                  <button
                    type="button"
                    className="btn-primary flex items-center gap-1 text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                    onClick={handleAcceptAiAndFinalize}
                    disabled={saving || runningAi}
                  >
                    {saving ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    Accept AI & Finalize Amendment
                  </button>
                  <button
                    type="button"
                    className="btn-secondary flex items-center gap-1 text-[11px] text-slate-600 hover:text-slate-800 dark:text-slate-300"
                    onClick={() => handleRunAiReview(true)}
                    disabled={runningAi || saving}
                    title="Force AI re-evaluation of all answers"
                  >
                    {runningAi ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    Regenerate AI
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn-secondary flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-800 dark:text-indigo-300"
                  onClick={() => handleRunAiReview(false)}
                  disabled={runningAi || saving}
                >
                  {runningAi ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Evaluating Answers...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3.5 w-3.5" />
                      AI Review Attempt
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {aiError && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{aiError}</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>Scorecard amended successfully. Recalculated authoritative total saved.</span>
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

        {/* Live Score Projection Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/50">
          <span className="text-slate-500 font-medium">Score Comparison & Projection:</span>
          <div className="flex items-center gap-3 font-mono">
            <span className="text-slate-400 line-through">
              Previous: {attempt.totalMarks ?? 0}/{maxTotal}
            </span>
            {currentAiReview?.overallSuggestedScore !== undefined && (
              <span className="text-indigo-600 dark:text-indigo-400">
                AI Suggestion: {currentAiReview.overallSuggestedScore}/{maxTotal}
              </span>
            )}
            <span className="font-bold text-brand-600 dark:text-brand-400">
              Amended: {amendedTotal}/{maxTotal} ({maxTotal > 0 ? Math.round((amendedTotal / maxTotal) * 100) : 0}%)
            </span>
          </div>
        </div>

        {/* Question Amendment Rows */}
        <div className="max-h-96 space-y-3.5 overflow-y-auto pr-1">
          {attempt.answers.map((ans, idx) => {
            const q = ans.questionSnapshot ?? questionSnapshots?.[ans.questionId];
            const questionContent = q?.questionText || `Question #${idx + 1}`;
            const qState = amendments[ans.questionId] || {
              marks: ans.marks ?? 0,
              comments: ans.comments ?? "",
            };
            const prevFinalScore = ans.marks ?? 0;
            const aiReview = aiReviewsMap.get(ans.questionId);

            return (
              <div
                key={ans.questionId}
                className="rounded-xl border border-slate-200 p-3.5 text-xs space-y-2.5 dark:border-slate-700"
              >
                {/* Question Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <span className="font-mono font-bold text-slate-500">Q#{idx + 1}</span>
                    <QuestionContent
                      content={questionContent}
                      className="mt-1 font-medium text-slate-800 dark:text-slate-200"
                    />
                  </div>
                </div>

                {/* Score Comparison Strip (Previous Final, AI Suggested, New Auditor Score) */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2 text-xs dark:border-slate-700 dark:bg-slate-800/60">
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        Previous Final
                      </span>
                      <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                        {prevFinalScore} / {ans.maxMarks}
                      </span>
                    </div>

                    {aiReview && (
                      <div className="border-l border-slate-200 pl-3 dark:border-slate-700">
                        <span className="block text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
                          AI Suggested
                        </span>
                        <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                          {aiReview.aiSuggestedScore} / {ans.maxMarks}
                        </span>
                      </div>
                    )}

                    <div className="border-l border-slate-200 pl-3 dark:border-slate-700">
                      <span className="block text-[10px] font-semibold uppercase tracking-wider text-brand-600 dark:text-brand-400">
                        New Auditor Score
                      </span>
                      <div className="flex items-center gap-1">
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
                        <span className="font-mono text-slate-400">/ {ans.maxMarks}</span>
                      </div>
                    </div>
                  </div>

                  {/* Question Action Controls */}
                  <div className="flex items-center gap-1.5">
                    {aiReview && qState.marks !== aiReview.aiSuggestedScore && (
                      <button
                        type="button"
                        className="btn-secondary flex items-center gap-1 py-1 px-2 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                        onClick={() => handleAcceptSingleAi(ans.questionId, aiReview.aiSuggestedScore)}
                        disabled={saving || success}
                      >
                        <Sparkles className="h-3 w-3" />
                        Accept AI ({aiReview.aiSuggestedScore})
                      </button>
                    )}
                    {qState.marks !== prevFinalScore && (
                      <button
                        type="button"
                        className="text-[11px] text-slate-400 hover:text-slate-600 underline px-1 dark:hover:text-slate-300"
                        onClick={() => handleResetToPrevious(ans.questionId, prevFinalScore)}
                        disabled={saving || success}
                      >
                        Reset to Prev ({prevFinalScore})
                      </button>
                    )}
                  </div>
                </div>

                {/* Candidate Answer */}
                <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Candidate Response:
                  </span>
                  {q ? (
                    <AnswerDisplay question={q} agentAnswer={ans.agentAnswer} />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm">{ans.agentAnswer || "(no answer)"}</p>
                  )}
                </div>

                {/* AI Review Details (Reasoning, Missing Points, Issues) */}
                {aiReview && (
                  <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-2.5 text-xs dark:border-indigo-900/40 dark:bg-indigo-950/20">
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-indigo-900 dark:text-indigo-200">
                          AI Reasoning:
                        </span>
                        {aiReview.verdict && (
                          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-300">
                            {aiReview.verdict.replace("_", " ")}
                          </span>
                        )}
                        {aiReview.understandingScore !== undefined && (
                          <span className="text-[10px] text-slate-500">
                            Understanding: {aiReview.understandingScore}/10
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {aiReview.confidence?.toUpperCase()} confidence
                      </span>
                    </div>

                    <p className="mt-1 text-slate-700 dark:text-slate-300">{aiReview.reasoning}</p>

                    {Array.isArray(aiReview.missingPoints) && aiReview.missingPoints.length > 0 && (
                      <div className="mt-1.5">
                        <span className="font-semibold text-[10px] text-amber-700 dark:text-amber-400">
                          Missing Points:
                        </span>
                        <ul className="list-inside list-disc text-[11px] text-amber-800 dark:text-amber-300">
                          {aiReview.missingPoints.map((pt, i) => (
                            <li key={i}>{pt}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {Array.isArray(aiReview.detectedIssues) && aiReview.detectedIssues.length > 0 && (
                      <div className="mt-1">
                        <span className="font-semibold text-[10px] text-red-700 dark:text-red-400">
                          Detected Issues:
                        </span>
                        <ul className="list-inside list-disc text-[11px] text-red-800 dark:text-red-300">
                          {aiReview.detectedIssues.map((iss, i) => (
                            <li key={i}>{iss}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Comments & Knowledge Gap */}
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
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div>
            {currentAiReview?.status === "complete" && (
              <button
                type="button"
                className="btn-secondary flex items-center gap-1 text-xs text-indigo-700 hover:text-indigo-800 dark:text-indigo-300"
                onClick={handleAcceptAllAi}
                disabled={saving}
              >
                <Sparkles className="h-3.5 w-3.5" /> Accept All AI Scores
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary text-xs" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            {currentAiReview?.status === "complete" && (
              <button
                type="button"
                className="btn-secondary flex items-center gap-1.5 text-xs font-semibold text-indigo-700 border-indigo-200 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300"
                onClick={handleAcceptAiAndFinalize}
                disabled={saving || success}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                )}
                Accept AI & Finalize Amendment
              </button>
            )}
            <button
              type="button"
              className="btn-primary flex items-center gap-1.5 text-xs font-semibold"
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
      </div>
    </Modal>
  );
}