"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { fetchExams } from "@/lib/exams";
import {
  fetchAttemptsForExam,
  saveReviewDraft,
  saveAllReviewDrafts,
  finalizeReview,
} from "@/lib/attempts";
import { getQuestion } from "@/lib/questions";
import { fetchAllUsers } from "@/lib/users";
import { useAuth } from "@/context/AuthContext";
import { auth } from "@/lib/firebase";
import {
  fetchAiReview,
  runAiReviewAllForAttempt,
  recordAuditorOverride,
} from "@/lib/aiReview";
import type {
  Exam,
  ExamAttempt,
  Question,
  AppUser,
  KnowledgeGapCategory,
  AttemptAiReview,
  AiQuestionEvaluation,
  AiReviewProgress,
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
  Sparkles,
  RotateCcw,
  Check,
  AlertCircle,
  X,
  Bot,
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

  const [finalizingId, setFinalizingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // AI Review States keyed by attemptId
  const [aiReviews, setAiReviews] = useState<
    Record<string, AttemptAiReview | null>
  >({});
  const [aiRunning, setAiRunning] = useState<Record<string, boolean>>({});
  const [aiProgress, setAiProgress] = useState<
    Record<string, AiReviewProgress>
  >({});
  const [auditorOverrides, setAuditorOverrides] = useState<
    Record<string, Set<string>>
  >({});

  useEffect(() => {
    fetchExams().then(setExams);
    fetchAllUsers().then(setUsers);
  }, []);

  const loadAttempts = useCallback(
    async (examId: string) => {
      const list = await fetchAttemptsForExam(examId);
      setAttempts(list);

      const ids = new Set(
        list.flatMap((a) => a.answers.map((ans) => ans.questionId))
      );

      const missing = Array.from(ids).filter((id) => !questionCache[id]);

      if (missing.length) {
        const fetched = await Promise.all(
          missing.map((id) => getQuestion(id))
        );

        setQuestionCache((prev) => {
          const next = { ...prev };
          fetched.forEach((q) => {
            if (q) next[q.id] = q;
          });
          return next;
        });
      }
    },
    [questionCache]
  );

  useEffect(() => {
    if (!selectedExam) {
      setAttempts([]);
      return;
    }

    loadAttempts(selectedExam);
  }, [selectedExam, loadAttempts]);

  // Load AI review and initialize auditor overrides when an attempt is expanded
  useEffect(() => {
    if (!expanded) return;

    const attempt = attempts.find((a) => a.id === expanded);
    if (!attempt) return;

    if (aiReviews[expanded] === undefined) {
      fetchAiReview(expanded).then((review) => {
        setAiReviews((prev) => ({ ...prev, [expanded]: review }));

        // Identify which questions have already been scored or modified by the auditor
        const overrides = new Set<string>();

        // 1. Check score history (explicit prior changes)
        attempt.answers.forEach((ans) => {
          if (
            ans.marks !== undefined &&
            (ans.scoreHistory?.length || review?.auditorOverrides?.includes(ans.questionId))
          ) {
            overrides.add(ans.questionId);
          }
        });

        // 2. Add persisted auditor overrides from the AI review record
        if (review?.auditorOverrides) {
          review.auditorOverrides.forEach((qid) => overrides.add(qid));
        }

        setAuditorOverrides((prev) => ({
          ...prev,
          [expanded]: overrides,
        }));
      });
    }
  }, [expanded, attempts, aiReviews]);

  async function refreshAttempts() {
    if (!selectedExam) return;
    await loadAttempts(selectedExam);
  }

  function userName(uid: string) {
    return users.find((u) => u.uid === uid)?.name ?? uid.slice(0, 8);
  }

  function handleMarkAuditorModified(attemptId: string, questionId: string) {
    setAuditorOverrides((prev) => {
      const current = new Set(prev[attemptId] ?? []);
      current.add(questionId);
      return { ...prev, [attemptId]: current };
    });
    recordAuditorOverride(attemptId, questionId);
  }

  async function handleRunAiReview(attempt: ExamAttempt) {
    if (!profile) return;

    const existingOverrides = auditorOverrides[attempt.id] ?? new Set();
    const existingReview = aiReviews[attempt.id];
    const hasAuditorEdits =
      existingOverrides.size > 0 ||
      attempt.answers.some((a) => a.marks !== undefined);

    // Confirm with auditor before running
    const confirmMessage = hasAuditorEdits || existingReview
      ? `Run AI Review on ${userName(attempt.agentId)} - Attempt #${attempt.attemptNumber}?\n\nAI review will refresh AI suggestions. Existing auditor edits will be preserved.`
      : `Run AI Review on all ${attempt.answers.length} answers in Attempt #${attempt.attemptNumber}?`;

    if (!window.confirm(confirmMessage)) return;

    try {
      setAiRunning((prev) => ({ ...prev, [attempt.id]: true }));
      setMessage(null);

      const idToken = await auth.currentUser?.getIdToken();
      const examObject = exams.find((e) => e.id === attempt.examId);

      if (!examObject) {
        throw new Error("Exam details could not be found.");
      }

      // Execute AI Review (deterministic + server-side AI evaluation)
      const reviewResult = await runAiReviewAllForAttempt({
        attempt,
        exam: examObject,
        questions: questionCache,
        auditorId: profile.uid,
        auditorName: profile.name || "Auditor",
        idToken,
        onProgress: (prog) => {
          setAiProgress((prev) => ({ ...prev, [attempt.id]: prog }));
        },
      });

      setAiReviews((prev) => ({ ...prev, [attempt.id]: reviewResult }));

      // Automatically populate untouched question drafts with AI suggestions
      // PRESERVING any questions that the auditor has already manually edited or scored
      const updatesToDraft: Array<{
        questionId: string;
        marks: number;
        comments?: string;
        knowledgeGapCategory?: KnowledgeGapCategory;
        changeReason?: string;
      }> = [];

      attempt.answers.forEach((ans) => {
        const isModifiedByAuditor = existingOverrides.has(ans.questionId);
        const evalResult = reviewResult.evaluations[ans.questionId];

        // Only populate if auditor has NOT modified it
        if (!isModifiedByAuditor && evalResult) {
          updatesToDraft.push({
            questionId: ans.questionId,
            marks: evalResult.suggestedMarks,
            comments: evalResult.suggestedComment || evalResult.reasoning,
            knowledgeGapCategory: evalResult.suggestedKnowledgeGap,
            changeReason: "Populated by AI Review suggestion",
          });
        }
      });

      if (updatesToDraft.length > 0) {
        await saveAllReviewDrafts(attempt, updatesToDraft, profile.uid);
        await refreshAttempts();
      }

      setMessage({
        type: "success",
        text: `AI Review Complete: ${reviewResult.totalSuggestedMarks}/${reviewResult.maxTotalMarks} suggested marks generated across ${reviewResult.answersReviewedCount} answers.`,
      });
    } catch (error) {
      console.error("AI review failed:", error);
      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? `AI review could not be completed: ${error.message}. You can continue manual review.`
            : "AI review could not be completed. You can continue manual review.",
      });
    } finally {
      setAiRunning((prev) => ({ ...prev, [attempt.id]: false }));
    }
  }

  async function handleFinalize(attempt: ExamAttempt) {
    if (!profile) return;

    const unscored = attempt.answers.filter((a) => a.marks === undefined);

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

      const finalized = await finalizeReview(attempt.id, profile.uid);

      setMessage({
        type: "success",
        text: `Review submitted successfully. Final score: ${
          finalized.totalMarks ?? 0
        }/${finalized.maxTotalMarks ?? 0}.`,
      });

      await refreshAttempts();
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
    (a) => a.status === "submitted" || a.status === "review_in_progress"
  ).length;

  const selectedExamObject = exams.find((e) => e.id === selectedExam);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Review Attempts</h1>

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
          <Badge color="amber">{pendingCount} pending review</Badge>
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

            const isExpanded = expanded === attempt.id;
            const currentAiReview = aiReviews[attempt.id];
            const isAiRunning = aiRunning[attempt.id] ?? false;
            const progress = aiProgress[attempt.id];
            const attemptOverrides =
              auditorOverrides[attempt.id] ?? new Set();

            return (
              <div key={attempt.id} className="card overflow-hidden">
                <button
                  className="flex w-full items-center justify-between gap-4 p-4 text-left"
                  onClick={() =>
                    setExpanded(isExpanded ? null : attempt.id)
                  }
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {isExpanded ? (
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
                        {new Date(attempt.startedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {currentAiReview && (
                      <Badge color="brand">
                        <Sparkles className="mr-1 h-3 w-3 inline" />
                        AI: {currentAiReview.totalSuggestedMarks}/
                        {currentAiReview.maxTotalMarks}
                      </Badge>
                    )}

                    {attempt.status !== "reviewed" && reviewedCount > 0 && (
                      <Badge color="slate">
                        {reviewedCount}/{attempt.answers.length} scored
                      </Badge>
                    )}

                    {attempt.status === "reviewed" &&
                    attempt.maxTotalMarks ? (
                      <Badge
                        color={
                          attempt.totalMarks === attempt.maxTotalMarks
                            ? "green"
                            : "brand"
                        }
                      >
                        {attempt.totalMarks}/{attempt.maxTotalMarks}
                      </Badge>
                    ) : (
                      <Badge
                        color={
                          attempt.status === "submitted"
                            ? "amber"
                            : attempt.status === "review_in_progress"
                            ? "brand"
                            : "slate"
                        }
                      >
                        {formatStatus(attempt.status)}
                      </Badge>
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-slate-100 p-4 dark:border-slate-700">
                    {/* =========================================================
                        AI REVIEW CONTROL BAR
                        ========================================================= */}
                    {attempt.status !== "reviewed" && (
                      <div className="mb-5">
                        {isAiRunning ? (
                          <div className="rounded-xl border border-purple-200 bg-purple-50/70 p-4 dark:border-purple-900/50 dark:bg-purple-950/20">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <Sparkles className="h-5 w-5 text-purple-600 animate-spin" />
                                <span className="font-semibold text-purple-900 dark:text-purple-300">
                                  {progress?.message ||
                                    `AI Reviewing... Question ${
                                      progress?.current ?? 0
                                    } of ${attempt.answers.length}`}
                                </span>
                              </div>
                              <span className="text-xs font-semibold text-purple-700 dark:text-purple-400">
                                {Math.round(
                                  ((progress?.current ?? 0) /
                                    (attempt.answers.length || 1)) *
                                    100
                                )}
                                %
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-purple-200 dark:bg-purple-900">
                              <div
                                className="h-full bg-purple-600 transition-all duration-300"
                                style={{
                                  width: `${Math.round(
                                    ((progress?.current ?? 0) /
                                      (attempt.answers.length || 1)) *
                                      100
                                  )}%`,
                                }}
                              />
                            </div>
                          </div>
                        ) : currentAiReview ? (
                          <div className="rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50/80 to-blue-50/60 p-4 dark:border-purple-900/50 dark:bg-purple-950/20">
                            <div className="flex flex-wrap items-center justify-between gap-4">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <Sparkles className="h-4 w-4 text-purple-600" />
                                  <span className="text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-400">
                                    AI Review Complete
                                  </span>
                                  {currentAiReview.status === "partial" && (
                                    <Badge color="amber">Partial</Badge>
                                  )}
                                </div>
                                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                                  Overall AI Suggested Score:{" "}
                                  <span className="text-lg font-bold text-purple-700 dark:text-purple-300">
                                    {currentAiReview.totalSuggestedMarks} /{" "}
                                    {currentAiReview.maxTotalMarks}
                                  </span>
                                  <span className="text-xs text-slate-500 ml-2">
                                    (
                                    {Math.round(
                                      (currentAiReview.totalSuggestedMarks /
                                        (currentAiReview.maxTotalMarks || 1)) *
                                        100
                                    )}
                                    %)
                                  </span>
                                </p>
                                <p className="text-xs text-slate-500">
                                  {currentAiReview.answersReviewedCount} answers
                                  analyzed · Initiated by{" "}
                                  {currentAiReview.initiatedByName || "Auditor"}
                                  {currentAiReview.completedAt
                                    ? ` on ${new Date(
                                        currentAiReview.completedAt
                                      ).toLocaleTimeString([], {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })}`
                                    : ""}
                                </p>
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  className="btn-secondary text-xs flex items-center gap-1.5"
                                  onClick={() => handleRunAiReview(attempt)}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  Re-run AI Review
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="rounded-xl border border-dashed border-purple-300 bg-purple-50/40 p-4 dark:border-purple-800/60 dark:bg-purple-950/10">
                            <div className="flex flex-wrap items-center justify-between gap-4">
                              <div>
                                <div className="flex items-center gap-2">
                                  <Sparkles className="h-4 w-4 text-purple-600" />
                                  <p className="text-sm font-semibold text-purple-900 dark:text-purple-300">
                                    AI-Assisted Answer Review
                                  </p>
                                </div>
                                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                                  Review entire attempt with AI · Evaluates
                                  quality, identifies key points, and suggests
                                  marks out of 10.
                                </p>
                              </div>

                              <button
                                className="btn-primary flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white shadow-sm"
                                onClick={() => handleRunAiReview(attempt)}
                              >
                                <Sparkles className="h-4 w-4" />
                                AI Review All
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Overall Review Progress & Draft Score */}
                    {attempt.status !== "reviewed" && (
                      <div className="mb-5 rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">Review Progress</p>
                            <p className="mt-1 text-sm text-slate-500">
                              {reviewedCount} of {attempt.answers.length}{" "}
                              questions reviewed
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

                    {/* =========================================================
                        PER-QUESTION EVALUATION ROWS
                        ========================================================= */}
                    <div className="space-y-4">
                      {attempt.answers.map((ans, index) => {
                        const q = questionCache[ans.questionId];
                        if (!q) return null;

                        const aiEval =
                          currentAiReview?.evaluations?.[ans.questionId];
                        const isModified = attemptOverrides.has(ans.questionId);

                        return (
                          <QuestionScoreRow
                            key={ans.questionId}
                            number={index + 1}
                            question={q}
                            answer={ans}
                            attempt={attempt}
                            reviewerId={profile?.uid ?? ""}
                            disabled={attempt.status === "reviewed"}
                            aiEvaluation={aiEval}
                            isAuditorModified={isModified}
                            onAuditorModify={() =>
                              handleMarkAuditorModified(
                                attempt.id,
                                ans.questionId
                              )
                            }
                            onSaved={refreshAttempts}
                          />
                        );
                      })}
                    </div>

                    {/* =========================================================
                        FINALIZE REVIEW BAR
                        ========================================================= */}
                    {attempt.status !== "reviewed" && (
                      <div className="sticky bottom-3 mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div>
                            <p className="font-semibold">Finalize Review</p>
                            <p className="text-sm text-slate-500">
                              {allReviewed
                                ? `All questions reviewed. Final score will be: ${draftTotal}/${maxTotal}.`
                                : `${
                                    attempt.answers.length - reviewedCount
                                  } question(s) still need marks before submitting.`}
                            </p>
                          </div>

                          <button
                            className="btn-primary flex items-center gap-2"
                            disabled={
                              !allReviewed || finalizingId === attempt.id
                            }
                            onClick={() => handleFinalize(attempt)}
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
                              Final Score: {attempt.totalMarks ?? 0}/
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
  aiEvaluation,
  isAuditorModified,
  onAuditorModify,
  onSaved,
}: {
  number: number;
  question: Question;
  answer: ExamAttempt["answers"][number];
  attempt: ExamAttempt;
  reviewerId: string;
  disabled: boolean;
  aiEvaluation?: AiQuestionEvaluation;
  isAuditorModified: boolean;
  onAuditorModify: () => void;
  onSaved: () => void;
}) {
  const [marks, setMarks] = useState<number | "">(answer.marks ?? "");
  const [comments, setComments] = useState(answer.comments ?? "");
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
  }, [answer.marks, answer.comments, answer.knowledgeGapCategory]);

  const isRescore = answer.marks !== undefined;

  const numericMarks = marks === "" ? undefined : Number(marks);

  const needsKnowledgeGap =
    numericMarks !== undefined && numericMarks < answer.maxMarks;

  const markState = useMemo(() => {
    if (numericMarks === undefined) return "Not Reviewed";
    if (numericMarks === answer.maxMarks) return "Correct";
    if (numericMarks === 0) return "Incorrect";
    return "Partial";
  }, [numericMarks, answer.maxMarks]);

  function handleApplyAiSuggestion() {
    if (!aiEvaluation || disabled) return;
    setMarks(aiEvaluation.suggestedMarks);
    setComments(aiEvaluation.suggestedComment || aiEvaluation.reasoning);
    if (aiEvaluation.suggestedMarks < answer.maxMarks && aiEvaluation.suggestedKnowledgeGap) {
      setKnowledgeGap(aiEvaluation.suggestedKnowledgeGap);
    }
    setSaved(false);
  }

  async function handleSaveDraft() {
    if (!reviewerId) return;

    setError("");
    setSaved(false);

    if (numericMarks === undefined) {
      setError("Enter marks before saving.");
      return;
    }

    if (numericMarks < 0 || numericMarks > answer.maxMarks) {
      setError(`Marks must be between 0 and ${answer.maxMarks}.`);
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

      await saveReviewDraft(
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
      await onSaved();
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "Unable to save review."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Question {number}
            </p>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs text-slate-500 font-medium">
              {question.module}
              {question.feature ? ` / ${question.feature}` : ""}
            </span>
            <Badge color="slate">{question.difficulty}</Badge>
            {question.type && (
              <Badge color="brand">
                {question.type.replace(/_/g, " ")}
              </Badge>
            )}
          </div>

          <p className="mt-1 text-sm font-medium">{question.questionText}</p>
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

      {/* Case Study Context (if applicable) */}
      {question.caseStudyContext && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800">
          <p className="mb-1 font-semibold uppercase tracking-wider text-slate-500">
            Case Context
          </p>
          <p className="whitespace-pre-wrap">{question.caseStudyContext}</p>
        </div>
      )}

      {/* Expected Answer */}
      <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Expected Answer
        </p>
        <p className="whitespace-pre-wrap">{question.expectedAnswer}</p>
        {question.notes && (
          <p className="mt-1.5 text-xs text-slate-500 italic">
            Note: {question.notes}
          </p>
        )}
      </div>

      {/* Agent Answer */}
      <div className="mb-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Agent Answer
        </p>
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-800/50">
          <AnswerDisplay
            question={question}
            agentAnswer={answer.agentAnswer}
          />
        </div>
      </div>

      {/* =========================================================
          AI SUGGESTION & QUALITY EVALUATION CARD
          ========================================================= */}
      {aiEvaluation && (
        <div className="mb-4 rounded-xl border border-purple-200 bg-purple-50/30 p-4 dark:border-purple-900/40 dark:bg-purple-950/15">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-purple-100 pb-2.5 dark:border-purple-900/30">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-purple-600" />
              <span className="font-semibold text-purple-900 dark:text-purple-300 text-sm">
                AI Suggested Marks:
              </span>
              <span className="rounded-lg bg-purple-100 px-2.5 py-0.5 text-sm font-bold text-purple-800 dark:bg-purple-900/60 dark:text-purple-200">
                {aiEvaluation.suggestedMarks} / {aiEvaluation.maxMarks}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {aiEvaluation.isDeterministic ? (
                <Badge color="slate">Deterministic Key</Badge>
              ) : (
                <Badge
                  color={
                    aiEvaluation.confidence === "high"
                      ? "green"
                      : aiEvaluation.confidence === "medium"
                      ? "amber"
                      : "slate"
                  }
                >
                  Confidence: {aiEvaluation.confidence}
                </Badge>
              )}

              {isAuditorModified ? (
                <Badge color="amber">Auditor Modified</Badge>
              ) : (
                <Badge color="brand">AI Suggested</Badge>
              )}
            </div>
          </div>

          {/* Key Points Covered */}
          {aiEvaluation.keyPointsCovered.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">
                Key Points Covered:
              </p>
              <ul className="mt-1 space-y-1">
                {aiEvaluation.keyPointsCovered.map((point, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-1.5 text-xs text-green-800 dark:text-green-300"
                  >
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Missing Key Points */}
          {aiEvaluation.missingKeyPoints.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Missing Key Points:
              </p>
              <ul className="mt-1 space-y-1">
                {aiEvaluation.missingKeyPoints.map((point, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300"
                  >
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Potential Issues / Errors */}
          {aiEvaluation.errors.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">
                Potential Issues / Errors:
              </p>
              <ul className="mt-1 space-y-1">
                {aiEvaluation.errors.map((err, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-1.5 text-xs text-red-800 dark:text-red-300"
                  >
                    <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
                    <span>{err}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* AI Reasoning */}
          <div className="mt-3 pt-2 border-t border-purple-100 dark:border-purple-900/30">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              AI Evaluation:
            </p>
            <p className="mt-0.5 text-xs italic text-slate-700 dark:text-slate-300">
              &ldquo;{aiEvaluation.reasoning}&rdquo;
            </p>
          </div>

          {/* Button to Apply AI Suggestion if currently different */}
          {!disabled &&
            (marks !== aiEvaluation.suggestedMarks ||
              comments !== (aiEvaluation.suggestedComment || aiEvaluation.reasoning)) && (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  className="text-xs font-medium text-purple-700 hover:text-purple-800 dark:text-purple-400 hover:underline flex items-center gap-1"
                  onClick={handleApplyAiSuggestion}
                >
                  <RotateCcw className="h-3 w-3" />
                  Apply AI Suggestion ({aiEvaluation.suggestedMarks}/10)
                </button>
              </div>
            )}
        </div>
      )}

      {/* =========================================================
          AUDITOR DECISION & SCORING INPUTS
          ========================================================= */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[120px_1fr_220px]">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
            Auditor Marks / {answer.maxMarks}
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
              setMarks(value === "" ? "" : Number(value));
              setSaved(false);
              onAuditorModify();
            }}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
            Auditor Comments
          </label>

          <input
            className="input"
            value={comments}
            disabled={disabled}
            placeholder="Add feedback for this answer..."
            onChange={(e) => {
              setComments(e.target.value);
              setSaved(false);
              onAuditorModify();
            }}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
            Knowledge Gap
          </label>

          <select
            className="input"
            value={knowledgeGap}
            disabled={disabled || !needsKnowledgeGap}
            onChange={(e) => {
              setKnowledgeGap(e.target.value as KnowledgeGapCategory | "");
              setSaved(false);
              onAuditorModify();
            }}
          >
            <option value="">
              {needsKnowledgeGap ? "Select category..." : "Not required"}
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
        <p className="mt-2 text-xs font-medium text-red-600">{error}</p>
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

          {answer.scoreHistory && answer.scoreHistory.length > 0 && (
            <button
              className="flex items-center gap-1 text-xs text-slate-500 hover:underline"
              onClick={() => setShowHistory((s) => !s)}
            >
              <History className="h-3.5 w-3.5" />
              {answer.scoreHistory.length} score change(s)
            </button>
          )}
        </div>
      )}

      {showHistory && answer.scoreHistory && (
        <div className="mt-3 space-y-1 rounded-lg bg-amber-50 p-3 text-xs dark:bg-amber-900/20">
          {answer.scoreHistory.map((h, i) => (
            <p key={i}>
              Score changed to <strong>{h.marks}</strong> by {h.changedBy} -
              &quot;{h.reason}&quot; ({new Date(h.timestamp).toLocaleString()})
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