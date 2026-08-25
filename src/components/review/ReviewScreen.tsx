"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchExams } from "@/lib/exams";
import {
  fetchAttemptsForExam,
  saveReviewDraft,
  finalizeReview,
} from "@/lib/attempts";
import { getQuestionsByIds } from "@/lib/questions";
import { fetchAllUsers } from "@/lib/users";
import { useAuth } from "@/context/AuthContext";
import type {
  Exam,
  ExamAttempt,
  Question,
  AppUser,
  KnowledgeGapCategory,
} from "@/types";
import { AnswerDisplay } from "@/components/questions/AnswerDisplay";
import { Badge, EmptyState } from "@/components/ui/Primitives";
import {
  ChevronDown,
  ChevronRight,
  History,
  Save,
  CheckCircle2,
  AlertTriangle,
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

export function ReviewScreen() {
  const { profile } = useAuth();

  const [exams, setExams] = useState<Exam[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [selectedExam, setSelectedExam] = useState("");
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [questionCache, setQuestionCache] = useState<
    Record<string, Question>
  >({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const [finalizingId, setFinalizingId] = useState<string | null>(
    null
  );
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    Promise.all([fetchExams(), fetchAllUsers()])
      .then(([loadedExams, loadedUsers]) => {
        setExams(loadedExams);
        setUsers(loadedUsers);
      })
      .catch((err) => {
        console.error("Failed to load review data", err);
        setMessage({
          type: "error",
          text: err instanceof Error ? err.message : "Unable to load review data.",
        });
      });
  }, []);

  useEffect(() => {
    if (!selectedExam) {
      setAttempts([]);
      return;
    }

    loadAttempts(selectedExam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExam]);

  async function loadAttempts(examId: string) {
    const list = await fetchAttemptsForExam(examId);
    setAttempts(list);

    const ids = new Set(
      list.flatMap((a) =>
        a.answers.map((ans) => ans.questionId)
      )
    );

    const missing = Array.from(ids).filter(
      (id) => !questionCache[id]
    );

    if (missing.length) {
      const fetched = await getQuestionsByIds(missing);

      setQuestionCache((prev) => {
        const next = { ...prev };

        fetched.forEach((q) => {
          if (q) next[q.id] = q;
        });

        return next;
      });
    }
  }

  // Patches one attempt in local state instead of re-querying every attempt
  // for the exam. Both saveReviewDraft and finalizeReview already return the
  // full updated attempt, so there's no need to hit Firestore again just to
  // reflect a single-document change we already have in hand.
  function patchAttempt(updated: ExamAttempt) {
    setAttempts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  function userName(uid: string) {
    return (
      users.find((u) => u.uid === uid)?.name ??
      uid.slice(0, 8)
    );
  }

  async function handleFinalize(attempt: ExamAttempt) {
    if (!profile) return;

    const unscored = attempt.answers.filter(
      (a) => a.marks === undefined
    );

    if (unscored.length > 0) {
      setMessage({
        type: "error",
        text: `${unscored.length} question(s) still need to be reviewed.`,
      });
      return;
    }

    const confirmed = window.confirm(
      `Submit review for ${userName(
        attempt.agentId
      )} - Attempt #${attempt.attemptNumber}?\n\nOnce submitted, this attempt will become an official reviewed attempt.`
    );

    if (!confirmed) return;

    try {
      setFinalizingId(attempt.id);
      setMessage(null);

      const finalized = await finalizeReview(
        attempt.id,
        profile.uid
      );

      setMessage({
        type: "success",
        text: `Review submitted successfully. Final score: ${
          finalized.totalMarks ?? 0
        }/${finalized.maxTotalMarks ?? 0}.`,
      });

      patchAttempt(finalized);
    } catch (error) {
      console.error(error);

      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to submit review.",
      });
    } finally {
      setFinalizingId(null);
    }
  }

  const pendingCount = attempts.filter(
    (a) =>
      a.status === "submitted" ||
      a.status === "review_in_progress"
  ).length;

  const selectedExamObject = exams.find(
    (e) => e.id === selectedExam
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">
          Review Attempts
        </h1>

        <select
          className="input w-auto"
          value={selectedExam}
          onChange={(e) => {
            setSelectedExam(e.target.value);
            setExpanded(null);
            setMessage(null);
          }}
        >
          <option value="">Select an exam...</option>

          {exams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>

        {selectedExam && pendingCount > 0 && (
          <Badge color="amber">
            {pendingCount} pending review
          </Badge>
        )}
      </div>

      {selectedExamObject && (
        <div className="mb-4 text-sm text-slate-500">
          Exam mode:{" "}
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {selectedExamObject.mode === "until_perfect"
              ? "Perfect 10"
              : "Normal"}
          </span>
        </div>
      )}

      {message && (
        <div
          className={`mb-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}

          <span>{message.text}</span>
        </div>
      )}

      {!selectedExam ? (
        <EmptyState
          title="Pick an exam"
          subtitle="Choose an exam above to see agent attempts."
        />
      ) : attempts.length === 0 ? (
        <EmptyState
          title="No attempts yet"
          subtitle="Agents haven't attempted this exam yet."
        />
      ) : (
        <div className="space-y-2">
          {attempts.map((attempt) => {
            const reviewedCount = attempt.answers.filter(
              (a) => a.marks !== undefined
            ).length;

            const allReviewed =
              reviewedCount === attempt.answers.length;

            const draftTotal = attempt.answers.reduce(
              (sum, a) => sum + (a.marks ?? 0),
              0
            );

            const maxTotal = attempt.answers.reduce(
              (sum, a) => sum + a.maxMarks,
              0
            );

            return (
              <div
                key={attempt.id}
                className="card overflow-hidden"
              >
                <button
                  className="flex w-full items-center justify-between gap-4 p-4 text-left"
                  onClick={() =>
                    setExpanded(
                      expanded === attempt.id
                        ? null
                        : attempt.id
                    )
                  }
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {expanded === attempt.id ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}

                    <div className="min-w-0">
                      <p className="font-medium">
                        {userName(attempt.agentId)} - Attempt #
                        {attempt.attemptNumber}
                      </p>

                      <p className="text-xs text-slate-500">
                        {attempt.timeTakenSeconds
                          ? `${Math.round(
                              attempt.timeTakenSeconds / 60
                            )} min · `
                          : ""}

                        {new Date(
                          attempt.startedAt
                        ).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {attempt.status !== "reviewed" &&
                      reviewedCount > 0 && (
                        <Badge color="brand">
                          {reviewedCount}/
                          {attempt.answers.length} reviewed
                        </Badge>
                      )}

                    {attempt.status === "reviewed" &&
                    attempt.maxTotalMarks ? (
                      <Badge
                        color={
                          attempt.totalMarks ===
                          attempt.maxTotalMarks
                            ? "green"
                            : "brand"
                        }
                      >
                        {attempt.totalMarks}/
                        {attempt.maxTotalMarks}
                      </Badge>
                    ) : (
                      <Badge
                        color={
                          attempt.status === "submitted"
                            ? "amber"
                            : attempt.status ===
                              "review_in_progress"
                            ? "brand"
                            : "slate"
                        }
                      >
                        {formatStatus(attempt.status)}
                      </Badge>
                    )}
                  </div>
                </button>

                {expanded === attempt.id && (
                  <div className="border-t border-slate-100 p-4 dark:border-slate-700">
                    {attempt.status !== "reviewed" && (
                      <div className="mb-5 rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">
                              Review Progress
                            </p>

                            <p className="mt-1 text-sm text-slate-500">
                              {reviewedCount} of{" "}
                              {attempt.answers.length} questions
                              reviewed
                            </p>
                          </div>

                          <div className="text-right">
                            <p className="text-xs uppercase tracking-wide text-slate-500">
                              Current Draft Score
                            </p>

                            <p className="text-lg font-semibold">
                              {draftTotal}/{maxTotal}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                          <div
                            className="h-full bg-blue-600 transition-all"
                            style={{
                              width: `${
                                attempt.answers.length
                                  ? (reviewedCount /
                                      attempt.answers.length) *
                                    100
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    )}

                    <div className="space-y-4">
                      {attempt.answers.map((ans, index) => {
                        // The snapshot frozen on this attempt is
                        // deliberately redacted (no expectedAnswer/
                        // correctOptionIndex) so agents can't read
                        // answer keys through their own attempt document.
                        // Merge the live, auditor-only question cache's
                        // real answer key back in for the grading
                        // reference, while keeping the frozen historical
                        // question text/options/type. Older attempts
                        // without a snapshot fall back to the live cache
                        // entirely.
                        const live = questionCache[ans.questionId];
                        const q = ans.questionSnapshot
                          ? {
                              ...ans.questionSnapshot,
                              expectedAnswer:
                                live?.expectedAnswer ??
                                ans.questionSnapshot.expectedAnswer,
                              correctOptionIndex:
                                live?.correctOptionIndex ??
                                ans.questionSnapshot.correctOptionIndex,
                            }
                          : live;

                        if (!q) return null;

                        return (
                          <QuestionScoreRow
                            key={ans.questionId}
                            number={index + 1}
                            question={q}
                            answer={ans}
                            attempt={attempt}
                            reviewerId={profile?.uid ?? ""}
                            disabled={
                              attempt.status === "reviewed"
                            }
                            onSaved={patchAttempt}
                          />
                        );
                      })}
                    </div>

                    {attempt.status !== "reviewed" && (
                      <div className="sticky bottom-3 mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div>
                            <p className="font-semibold">
                              Finalize Review
                            </p>

                            <p className="text-sm text-slate-500">
                              {allReviewed
                                ? `All questions reviewed. Draft score: ${draftTotal}/${maxTotal}.`
                                : `${
                                    attempt.answers.length -
                                    reviewedCount
                                  } question(s) still need marks.`}
                            </p>
                          </div>

                          <button
                            className="btn-primary flex items-center gap-2"
                            disabled={
                              !allReviewed ||
                              finalizingId === attempt.id
                            }
                            onClick={() =>
                              handleFinalize(attempt)
                            }
                          >
                            <CheckCircle2 className="h-4 w-4" />

                            {finalizingId === attempt.id
                              ? "Submitting..."
                              : "Submit Review"}
                          </button>
                        </div>
                      </div>
                    )}

                    {attempt.status === "reviewed" && (
                      <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-5 w-5 text-green-600" />

                          <div>
                            <p className="font-semibold text-green-800 dark:text-green-300">
                              Review Completed
                            </p>

                            <p className="text-sm text-green-700 dark:text-green-400">
                              Final Score:{" "}
                              {attempt.totalMarks ?? 0}/
                              {attempt.maxTotalMarks ?? 0}
                              {attempt.reviewedAt
                                ? ` · ${new Date(
                                    attempt.reviewedAt
                                  ).toLocaleString()}`
                                : ""}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QuestionScoreRow({
  number,
  question,
  answer,
  attempt,
  reviewerId,
  disabled,
  onSaved,
}: {
  number: number;
  question: Question;
  answer: ExamAttempt["answers"][number];
  attempt: ExamAttempt;
  reviewerId: string;
  disabled: boolean;
  onSaved: (updated: ExamAttempt) => void;
}) {
  const [marks, setMarks] = useState<number | "">(
    answer.marks ?? ""
  );

  const [comments, setComments] = useState(
    answer.comments ?? ""
  );

  const [knowledgeGap, setKnowledgeGap] = useState<
    KnowledgeGapCategory | ""
  >(answer.knowledgeGapCategory ?? "");

  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setMarks(answer.marks ?? "");
    setComments(answer.comments ?? "");
    setKnowledgeGap(answer.knowledgeGapCategory ?? "");
  }, [
    answer.marks,
    answer.comments,
    answer.knowledgeGapCategory,
  ]);

  const isRescore = answer.marks !== undefined;

  const numericMarks =
    marks === "" ? undefined : Number(marks);

  const needsKnowledgeGap =
    numericMarks !== undefined &&
    numericMarks < answer.maxMarks;

  const markState = useMemo(() => {
    if (numericMarks === undefined) return "Not Reviewed";

    if (numericMarks === answer.maxMarks) return "Correct";

    if (numericMarks === 0) return "Incorrect";

    return "Partial";
  }, [numericMarks, answer.maxMarks]);

  async function handleSaveDraft() {
    if (!reviewerId) return;

    setError("");
    setSaved(false);

    if (numericMarks === undefined) {
      setError("Enter marks before saving.");
      return;
    }

    if (
      numericMarks < 0 ||
      numericMarks > answer.maxMarks
    ) {
      setError(
        `Marks must be between 0 and ${answer.maxMarks}.`
      );
      return;
    }

    if (needsKnowledgeGap && !knowledgeGap) {
      setError(
        "Select a knowledge gap category for an answer that did not receive full marks."
      );
      return;
    }

    try {
      setSaving(true);

      const updated = await saveReviewDraft(
        attempt,
        question.id,
        numericMarks,
        comments,
        reviewerId,
        knowledgeGap || undefined,
        isRescore ? reason : undefined
      );

      setSaved(true);
      setReason("");

      onSaved(updated);
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Unable to save review."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Question {number}
          </p>

          <p className="mt-1 text-sm font-medium">
            {question.questionText}
          </p>
        </div>

        <Badge
          color={
            markState === "Correct"
              ? "green"
              : markState === "Incorrect"
              ? "red"
              : markState === "Partial"
              ? "amber"
              : "slate"
          }
        >
          {markState}
        </Badge>
      </div>

      <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Expected Answer
        </p>

        <p>{question.expectedAnswer}</p>
      </div>

      <div className="mb-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Agent Answer
        </p>

        <AnswerDisplay
          question={question}
          agentAnswer={answer.agentAnswer}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[120px_1fr_220px]">
        <div>
          <label className="mb-1 block text-xs font-medium">
            Marks / {answer.maxMarks}
          </label>

          <input
            type="number"
            min={0}
            max={answer.maxMarks}
            className="input"
            value={marks}
            disabled={disabled}
            onChange={(e) => {
              const value = e.target.value;

              setMarks(
                value === "" ? "" : Number(value)
              );
              setSaved(false);
            }}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium">
            Reviewer Comments
          </label>

          <input
            className="input"
            value={comments}
            disabled={disabled}
            placeholder="Add feedback for this answer..."
            onChange={(e) => {
              setComments(e.target.value);
              setSaved(false);
            }}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium">
            Knowledge Gap
          </label>

          <select
            className="input"
            value={knowledgeGap}
            disabled={disabled || !needsKnowledgeGap}
            onChange={(e) => {
              setKnowledgeGap(
                e.target.value as KnowledgeGapCategory | ""
              );
              setSaved(false);
            }}
          >
            <option value="">
              {needsKnowledgeGap
                ? "Select category..."
                : "Not required"}
            </option>

            {KNOWLEDGE_GAPS.map((gap) => (
              <option key={gap} value={gap}>
                {gap}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isRescore && !disabled && (
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium">
            Reason for Score Change
          </label>

          <input
            className="input"
            placeholder="Optional reason for changing the previous score"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs font-medium text-red-600">
          {error}
        </p>
      )}

      {!disabled && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleSaveDraft}
            disabled={saving}
          >
            <Save className="h-4 w-4" />

            {saving
              ? "Saving..."
              : isRescore
              ? "Update Draft"
              : "Save Draft"}
          </button>

          {saved && (
            <span className="flex items-center gap-1 text-xs font-medium text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved
            </span>
          )}

          {answer.scoreHistory &&
            answer.scoreHistory.length > 0 && (
              <button
                className="flex items-center gap-1 text-xs text-slate-500 hover:underline"
                onClick={() =>
                  setShowHistory((s) => !s)
                }
              >
                <History className="h-3.5 w-3.5" />

                {answer.scoreHistory.length} score
                change(s)
              </button>
            )}
        </div>
      )}

      {showHistory && answer.scoreHistory && (
        <div className="mt-3 space-y-1 rounded-lg bg-amber-50 p-3 text-xs dark:bg-amber-900/20">
          {answer.scoreHistory.map((h, i) => (
            <p key={i}>
              Score changed to{" "}
              <strong>{h.marks}</strong> by{" "}
              {h.changedBy} - &quot;{h.reason}&quot; (
              {new Date(h.timestamp).toLocaleString()})
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function formatStatus(status: ExamAttempt["status"]) {
  switch (status) {
    case "in_progress":
      return "In Progress";

    case "submitted":
      return "Needs Review";

    case "review_in_progress":
      return "Review In Progress";

    case "reviewed":
      return "Reviewed";

    default:
      return status;
  }
}