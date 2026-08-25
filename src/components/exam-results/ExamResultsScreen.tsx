"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  RotateCcw,
  Users,
  X,
  XCircle,
} from "lucide-react";

import { getExam } from "@/lib/exams";
import { fetchAttemptsForExam } from "@/lib/attempts";
import { fetchAllUsers } from "@/lib/users";
import { getQuestionsByIds } from "@/lib/questions";

import type {
  AppUser,
  Exam,
  ExamAttempt,
  Question,
  AttemptAnswer,
} from "@/types";

import {
  Badge,
  EmptyState,
} from "@/components/ui/Primitives";

interface Props {
  examId: string;
}

type AgentResult = {
  agent: AppUser | undefined;
  agentId: string;
  attempts: ExamAttempt[];
  latestAttempt: ExamAttempt | undefined;
  latestReviewed: ExamAttempt | undefined;
  completed: boolean;
  awaitingReview: boolean;
  inProgress: boolean;
};

type AnswerState =
  | "correct"
  | "improvement"
  | "incorrect"
  | "unscored";

/* =========================================================
   MAIN SCREEN
   ========================================================= */

export function ExamResultsScreen({
  examId,
}: Props) {
  const [exam, setExam] =
    useState<Exam | null>(null);

  const [attempts, setAttempts] =
    useState<ExamAttempt[]>([]);

  const [users, setUsers] =
    useState<AppUser[]>([]);

  const [questions, setQuestions] =
    useState<Question[]>([]);

  const [loading, setLoading] =
    useState(true);

  const [
    selectedAttempt,
    setSelectedAttempt,
  ] = useState<ExamAttempt | null>(
    null
  );

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);

        const [
          examData,
          attemptData,
          userData,
        ] = await Promise.all([
          getExam(examId),
          fetchAttemptsForExam(examId),
          fetchAllUsers(),
        ]);

        setExam(examData);
        setAttempts(attemptData);
        setUsers(userData);

        if (examData) {
          const questionIds =
            examData.questions.map(
              (question) =>
                question.questionId
            );

          const questionData =
            await getQuestionsByIds(
              questionIds
            );

          setQuestions(questionData);
        } else {
          setQuestions([]);
        }
      } catch (error) {
        console.error(
          "Unable to load exam results:",
          error
        );
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [examId]);

  /* =======================================================
     GROUP ATTEMPTS BY AGENT
     ======================================================= */

  const agentResults =
    useMemo<AgentResult[]>(() => {
      if (!exam) return [];

      const agentIds =
        new Set<string>([
          ...exam.assignedAgentIds,
          ...attempts.map(
            (attempt) =>
              attempt.agentId
          ),
        ]);

      return Array.from(agentIds)
        .map((agentId) => {
          const agentAttempts =
            attempts
              .filter(
                (attempt) =>
                  attempt.agentId ===
                  agentId
              )
              .sort(
                (a, b) =>
                  a.attemptNumber -
                  b.attemptNumber
              );

          const latestAttempt =
            agentAttempts[
              agentAttempts.length - 1
            ];

          const reviewedAttempts =
            agentAttempts.filter(
              (attempt) =>
                attempt.status ===
                "reviewed"
            );

          const latestReviewed =
            reviewedAttempts[
              reviewedAttempts.length -
                1
            ];

          const completed =
            exam.mode ===
            "until_perfect"
              ? Boolean(
                  latestReviewed &&
                    latestReviewed.maxTotalMarks &&
                    latestReviewed.totalMarks ===
                      latestReviewed.maxTotalMarks
                )
              : reviewedAttempts.length >
                0;

          const awaitingReview =
            agentAttempts.some(
              (attempt) =>
                attempt.status ===
                  "submitted" ||
                attempt.status ===
                  "review_in_progress"
            );

          const inProgress =
            agentAttempts.some(
              (attempt) =>
                attempt.status ===
                "in_progress"
            );

          return {
            agent: users.find(
              (user) =>
                user.uid === agentId
            ),
            agentId,
            attempts: agentAttempts,
            latestAttempt,
            latestReviewed,
            completed,
            awaitingReview,
            inProgress,
          };
        })
        .sort((a, b) =>
          (
            a.agent?.name ??
            a.agentId
          ).localeCompare(
            b.agent?.name ??
              b.agentId
          )
        );
    }, [exam, attempts, users]);

  /* =======================================================
     SUMMARY METRICS
     ======================================================= */

  const agentsStarted =
    agentResults.filter(
      (result) =>
        result.attempts.length > 0
    ).length;

  const completedAgents =
    agentResults.filter(
      (result) => result.completed
    ).length;

  const pendingReview =
    agentResults.filter(
      (result) =>
        result.awaitingReview
    ).length;

  const totalReviewedAttempts =
    attempts.filter(
      (attempt) =>
        attempt.status === "reviewed"
    ).length;

  const averageAttempts =
    completedAgents > 0
      ? (
          agentResults
            .filter(
              (result) =>
                result.completed
            )
            .reduce(
              (sum, result) =>
                sum +
                result.attempts.filter(
                  (attempt) =>
                    attempt.status ===
                    "reviewed"
                ).length,
              0
            ) / completedAgents
        ).toFixed(1)
      : "0";

  if (loading) {
    return (
      <p className="text-sm text-slate-500">
        Loading exam results...
      </p>
    );
  }

  if (!exam) {
    return (
      <EmptyState
        title="Exam not found"
        subtitle="This exam may have been removed."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href={`/auditor/exams/${exam.id}`}
            className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Exam
          </Link>

          <h1 className="text-2xl font-semibold">
            {exam.name}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge color="brand">
              {exam.mode ===
              "until_perfect"
                ? "Perfect 10"
                : "Normal"}
            </Badge>

            <span className="text-sm text-slate-500">
              Competency Results
            </span>
          </div>
        </div>

        <div className="flex gap-3">
  <Link
    href={`/auditor/reports/${exam.id}`}
    className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
  >
    Generate Report
  </Link>

  <Link
    href={`/auditor/exams/${exam.id}/review`}
    className="btn-primary"
  >
    Review Attempts
  </Link>
</div>

      </div>

      {/* SUMMARY */}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          icon={
            <Users className="h-4 w-4" />
          }
          label="Agents Started"
          value={`${agentsStarted}/${agentResults.length}`}
        />

        <SummaryCard
          icon={
            <ClipboardCheck className="h-4 w-4" />
          }
          label="Completed"
          value={String(
            completedAgents
          )}
        />

        <SummaryCard
          icon={
            <RotateCcw className="h-4 w-4" />
          }
          label="Avg. Attempts"
          value={averageAttempts}
        />

        <SummaryCard
          icon={
            <Clock3 className="h-4 w-4" />
          }
          label="Pending Review"
          value={String(
            pendingReview
          )}
        />
      </div>

      {/* AGENT TABLE */}

      {agentResults.length === 0 ? (
        <EmptyState
          title="No agents assigned"
          subtitle="Assign agents to this exam to begin tracking competency."
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">
                  Agent Performance
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Click any attempt
                  symbol to inspect what
                  happened during that
                  attempt.
                </p>
              </div>

              <span className="text-xs text-slate-400">
                {
                  totalReviewedAttempts
                }{" "}
                reviewed attempts
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/60">
                <tr>
                  <th className="px-5 py-3">
                    Agent
                  </th>

                  <th className="px-5 py-3">
                    Attempts
                  </th>

                  <th className="px-5 py-3">
                    Status
                  </th>

                  <th className="px-5 py-3">
                    Latest Score
                  </th>

                  <th className="px-5 py-3">
                    Time
                  </th>

                  <th className="px-5 py-3">
                    Reviewed
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {agentResults.map(
                  (result) => (
                    <AgentRow
                      key={
                        result.agentId
                      }
                      result={result}
                      exam={exam}
                      onAttemptClick={
                        setSelectedAttempt
                      }
                    />
                  )
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ATTEMPT FORENSICS */}

      {selectedAttempt && (
        <AttemptDetailsModal
          attempt={
            selectedAttempt
          }
          exam={exam}
          questions={questions}
          agentName={
            users.find(
              (user) =>
                user.uid ===
                selectedAttempt.agentId
            )?.name ??
            selectedAttempt.agentId
          }
          reviewerName={
            users.find(
              (user) =>
                user.uid ===
                selectedAttempt.reviewedBy
            )?.name ??
            selectedAttempt.reviewedBy
          }
          previousAttempt={
            attempts
              .filter(
                (attempt) =>
                  attempt.agentId ===
                    selectedAttempt.agentId &&
                  attempt.examId ===
                    selectedAttempt.examId &&
                  attempt.attemptNumber ===
                    selectedAttempt.attemptNumber -
                      1
              )
              .sort(
                (a, b) =>
                  b.attemptNumber -
                  a.attemptNumber
              )[0]
          }
          onClose={() =>
            setSelectedAttempt(null)
          }
        />
      )}
    </div>
  );
}

/* =========================================================
   AGENT ROW
   ========================================================= */

function AgentRow({
  result,
  exam,
  onAttemptClick,
}: {
  result: AgentResult;
  exam: Exam;
  onAttemptClick: (
    attempt: ExamAttempt
  ) => void;
}) {
  const latest =
    result.latestReviewed ??
    result.latestAttempt;

  return (
    <tr className="hover:bg-slate-50/70 dark:hover:bg-slate-800/30">
      <td className="px-5 py-4">
        <div>
          <p className="font-medium">
            {result.agent?.name ??
              result.agentId.slice(
                0,
                10
              )}
          </p>

          {result.agent?.email && (
            <p className="mt-0.5 text-xs text-slate-500">
              {result.agent.email}
            </p>
          )}
        </div>
      </td>

      <td className="px-5 py-4">
        {result.attempts.length ===
        0 ? (
          <span className="text-sm text-slate-400">
            Not started
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {result.attempts.map(
              (attempt) => (
                <AttemptSymbol
                  key={attempt.id}
                  attempt={attempt}
                  exam={exam}
                  onClick={() =>
                    onAttemptClick(
                      attempt
                    )
                  }
                />
              )
            )}
          </div>
        )}
      </td>

      <td className="px-5 py-4">
        <StatusBadge
          result={result}
        />
      </td>

      <td className="px-5 py-4">
        {result.latestReviewed
          ?.maxTotalMarks ? (
          <div>
            <p className="font-semibold">
              {result.latestReviewed
                .totalMarks ?? 0}
              /
              {
                result.latestReviewed
                  .maxTotalMarks
              }
            </p>

            <p className="text-xs text-slate-500">
              {Math.round(
                ((result.latestReviewed
                  .totalMarks ?? 0) /
                  result.latestReviewed
                    .maxTotalMarks) *
                  100
              )}
              %
            </p>
          </div>
        ) : (
          <span className="text-slate-400">
            -
          </span>
        )}
      </td>

      <td className="px-5 py-4 text-sm">
        {latest?.timeTakenSeconds
          ? formatDuration(
              latest.timeTakenSeconds
            )
          : "-"}
      </td>

      <td className="px-5 py-4 text-sm text-slate-500">
        {result.latestReviewed
          ?.reviewedAt
          ? new Date(
              result.latestReviewed
                .reviewedAt
            ).toLocaleDateString()
          : "-"}
      </td>
    </tr>
  );
}

/* =========================================================
   ATTEMPT SYMBOL
   ========================================================= */

function AttemptSymbol({
  attempt,
  exam,
  onClick,
}: {
  attempt: ExamAttempt;
  exam: Exam;
  onClick: () => void;
}) {
  const perfect =
    attempt.status ===
      "reviewed" &&
    Boolean(
      attempt.maxTotalMarks
    ) &&
    attempt.totalMarks ===
      attempt.maxTotalMarks;

  const reviewedFail =
    attempt.status ===
      "reviewed" &&
    !perfect;

  let label = `Attempt #${attempt.attemptNumber}`;

  if (perfect) {
    label += " - Complete";
  } else if (reviewedFail) {
    label += " - Below target";
  } else if (
    attempt.status ===
    "submitted"
  ) {
    label += " - Needs review";
  } else if (
    attempt.status ===
    "review_in_progress"
  ) {
    label += " - Under review";
  } else {
    label += " - In progress";
  }

  const normalComplete =
    exam.mode === "normal" &&
    attempt.status ===
      "reviewed";

  if (
    perfect ||
    normalComplete
  ) {
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={onClick}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-green-200 bg-green-50 text-green-700 transition hover:scale-105 hover:bg-green-100 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400"
      >
        <Check className="h-4 w-4" />
      </button>
    );
  }

  if (reviewedFail) {
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={onClick}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-red-50 text-red-700 transition hover:scale-105 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
      >
        <X className="h-4 w-4" />
      </button>
    );
  }

  if (
    attempt.status ===
      "submitted" ||
    attempt.status ===
      "review_in_progress"
  ) {
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={onClick}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-700 transition hover:scale-105 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
      >
        <span className="text-lg leading-none">
          •
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition hover:scale-105 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
    >
      <span className="text-lg leading-none">
        ○
      </span>
    </button>
  );
}

/* =========================================================
   STATUS BADGE
   ========================================================= */

function StatusBadge({
  result,
}: {
  result: AgentResult;
}) {
  if (result.completed) {
    return (
      <Badge color="green">
        Completed
      </Badge>
    );
  }

  if (result.awaitingReview) {
    return (
      <Badge color="amber">
        Needs Review
      </Badge>
    );
  }

  if (result.inProgress) {
    return (
      <Badge color="brand">
        In Progress
      </Badge>
    );
  }

  if (
    result.latestReviewed &&
    !result.completed
  ) {
    return (
      <Badge color="red">
        Re-Exam Required
      </Badge>
    );
  }

  return (
    <Badge color="slate">
      Not Started
    </Badge>
  );
}

/* =========================================================
   ATTEMPT DETAILS MODAL
   ========================================================= */

function AttemptDetailsModal({
  attempt,
  exam,
  questions,
  agentName,
  reviewerName,
  previousAttempt,
  onClose,
}: {
  attempt: ExamAttempt;
  exam: Exam;
  questions: Question[];
  agentName: string;
  reviewerName?: string;
  previousAttempt?: ExamAttempt;
  onClose: () => void;
}) {
  const [
    expandedQuestions,
    setExpandedQuestions,
  ] = useState<Set<string>>(
    new Set()
  );

  const questionMap =
    useMemo(() => {
      return new Map(
        questions.map(
          (question) => [
            question.id,
            question,
          ]
        )
      );
    }, [questions]);

  const answerRows =
    attempt.answers.map(
      (answer) => {
        const live = questionMap.get(
          answer.questionId
        );

        // The snapshot frozen on this attempt is deliberately redacted
        // (no expectedAnswer/correctOptionIndex) so agents can't read
        // answer keys through their own attempt document. This report is
        // auditor-only, and the auditor's `questions` fetch above DOES
        // carry the real answer key — merge it back in for display so
        // the reference grading answer isn't blank, while still keeping
        // the frozen historical question text/options/type.
        const question = answer.questionSnapshot
          ? {
              ...answer.questionSnapshot,
              expectedAnswer:
                live?.expectedAnswer ??
                answer.questionSnapshot.expectedAnswer,
              correctOptionIndex:
                live?.correctOptionIndex ??
                answer.questionSnapshot.correctOptionIndex,
            }
          : live;

        return {
          answer,
          question,
          state: getAnswerState(answer),
        };
      }
    );

  const correctCount =
    answerRows.filter(
      (row) =>
        row.state === "correct"
    ).length;

  const improvementCount =
    answerRows.filter(
      (row) =>
        row.state ===
        "improvement"
    ).length;

  const incorrectCount =
    answerRows.filter(
      (row) =>
        row.state ===
        "incorrect"
    ).length;

  const unscoredCount =
    answerRows.filter(
      (row) =>
        row.state === "unscored"
    ).length;

  const percentage =
    attempt.totalMarks !==
      undefined &&
    attempt.maxTotalMarks
      ? Math.round(
          (attempt.totalMarks /
            attempt.maxTotalMarks) *
            100
        )
      : calculateDraftPercentage(
          attempt.answers
        );

  const previousAnswerMap =
    new Map(
      (
        previousAttempt?.answers ??
        []
      ).map((answer) => [
        answer.questionId,
        answer,
      ])
    );

  function toggleQuestion(
    questionId: string
  ) {
    setExpandedQuestions(
      (current) => {
        const next =
          new Set(current);

        if (
          next.has(questionId)
        ) {
          next.delete(
            questionId
          );
        } else {
          next.add(
            questionId
          );
        }

        return next;
      }
    );
  }

  function expandAll() {
    setExpandedQuestions(
      new Set(
        attempt.answers.map(
          (answer) =>
            answer.questionId
        )
      )
    );
  }

  function collapseAll() {
    setExpandedQuestions(
      new Set()
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        {/* MODAL HEADER */}

        <div className="border-b border-slate-200 px-5 py-5 dark:border-slate-700 sm:px-7">
          <div className="flex items-start justify-between gap-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Attempt #
                  {
                    attempt.attemptNumber
                  }
                </p>

                <AttemptStatusBadge
                  attempt={attempt}
                  exam={exam}
                />
              </div>

              <h2 className="mt-2 text-xl font-semibold sm:text-2xl">
                {agentName}
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                {exam.name}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* TOP STATS */}

          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <ModalStat
              label="Score"
              value={
                attempt.totalMarks !==
                  undefined &&
                attempt.maxTotalMarks
                  ? `${attempt.totalMarks}/${attempt.maxTotalMarks}`
                  : "Pending"
              }
            />

            <ModalStat
              label="Percentage"
              value={
                percentage !== null
                  ? `${percentage}%`
                  : "-"
              }
            />

            <ModalStat
              label="Time Taken"
              value={
                attempt.timeTakenSeconds
                  ? formatDuration(
                      attempt.timeTakenSeconds
                    )
                  : "-"
              }
            />

            <ModalStat
              label="Reviewer"
              value={
                reviewerName ??
                "Not reviewed"
              }
            />

            <ModalStat
              label="Reviewed"
              value={
                attempt.reviewedAt
                  ? formatDateTime(
                      attempt.reviewedAt
                    )
                  : "-"
              }
            />
          </div>
        </div>

        {/* SCROLLABLE CONTENT */}

        <div className="overflow-y-auto px-5 py-5 sm:px-7">
          {/* ANSWER SUMMARY */}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <AnswerSummary
              icon={
                <CheckCircle2 className="h-4 w-4" />
              }
              label="Correct"
              value={correctCount}
              tone="green"
            />

            <AnswerSummary
              icon={
                <CircleAlert className="h-4 w-4" />
              }
              label="Needs Improvement"
              value={
                improvementCount
              }
              tone="amber"
            />

            <AnswerSummary
              icon={
                <XCircle className="h-4 w-4" />
              }
              label="Incorrect"
              value={
                incorrectCount
              }
              tone="red"
            />

            <AnswerSummary
              icon={
                <Clock3 className="h-4 w-4" />
              }
              label="Unscored"
              value={
                unscoredCount
              }
              tone="slate"
            />
          </div>

          {/* QUESTION HEADER */}

          <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">
                Question Analysis
              </h3>

              <p className="mt-1 text-sm text-slate-500">
                Compare the
                agent&apos;s response
                with the expected answer
                and auditor feedback.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={expandAll}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Expand all
              </button>

              <button
                type="button"
                onClick={collapseAll}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Collapse all
              </button>
            </div>
          </div>

          {/* QUESTIONS */}

          <div className="mt-4 space-y-3">
            {answerRows.map(
              (
                {
                  answer,
                  question,
                  state,
                },
                index
              ) => {
                const expanded =
                  expandedQuestions.has(
                    answer.questionId
                  );

                const previousAnswer =
                  previousAnswerMap.get(
                    answer.questionId
                  );

                return (
                  <QuestionAnalysisCard
                    key={
                      answer.questionId
                    }
                    number={
                      index + 1
                    }
                    answer={answer}
                    question={question}
                    state={state}
                    expanded={
                      expanded
                    }
                    previousAnswer={
                      previousAnswer
                    }
                    previousAttemptNumber={
                      previousAttempt?.attemptNumber
                    }
                    onToggle={() =>
                      toggleQuestion(
                        answer.questionId
                      )
                    }
                  />
                );
              }
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   QUESTION ANALYSIS CARD
   ========================================================= */

function QuestionAnalysisCard({
  number,
  answer,
  question,
  state,
  expanded,
  previousAnswer,
  previousAttemptNumber,
  onToggle,
}: {
  number: number;
  answer: AttemptAnswer;
  question?: Question;
  state: AnswerState;
  expanded: boolean;
  previousAnswer?: AttemptAnswer;
  previousAttemptNumber?: number;
  onToggle: () => void;
}) {
  const previousState =
    previousAnswer
      ? getAnswerState(
          previousAnswer
        )
      : undefined;

  const improvement =
    calculateAnswerImprovement(
      previousAnswer,
      answer
    );

  return (
    <div
      className={`overflow-hidden rounded-xl border ${getQuestionBorderClass(
        state
      )}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-4 p-4 text-left transition hover:bg-slate-50/70 dark:hover:bg-slate-800/30"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">
              Q{number}
            </span>

            {question?.module && (
              <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                {
                  question.module
                }
              </span>
            )}

            {question?.feature && (
              <span className="text-xs text-slate-400">
                {
                  question.feature
                }
              </span>
            )}

            <AnswerStateBadge
              state={state}
            />
          </div>

          <p className="mt-2 line-clamp-2 text-sm font-medium text-slate-800 dark:text-slate-100">
            {question?.questionText ??
              "Question details unavailable"}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <div className="text-right">
            <p className="font-semibold">
              {answer.marks ??
                "-"}
              /
              {
                answer.maxMarks
              }
            </p>

            <p className="text-[11px] text-slate-400">
              marks
            </p>
          </div>

          {expanded ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-200 bg-slate-50/40 p-4 dark:border-slate-700 dark:bg-slate-950/20 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-2">
            <AnswerBox
              label="Agent Answer"
              value={
                answer.agentAnswer?.trim() ||
                "(No answer provided)"
              }
              variant="agent"
            />

            <AnswerBox
              label="Expected Answer"
              value={
                question?.expectedAnswer?.trim() ||
                "(Expected answer unavailable)"
              }
              variant="expected"
            />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DetailItem
              label="Marks"
              value={`${
                answer.marks ?? "-"
              } / ${
                answer.maxMarks
              }`}
            />

            <DetailItem
              label="Knowledge Gap"
              value={
                answer.knowledgeGapCategory ??
                "Not categorized"
              }
            />

            <DetailItem
              label="Result"
              value={
                getAnswerStateLabel(
                  state
                )
              }
            />

            <DetailItem
              label="Previous Attempt"
              value={
                previousAnswer &&
                previousAttemptNumber
                  ? `${previousAnswer.marks ?? "-"} / ${previousAnswer.maxMarks}`
                  : "No previous attempt"
              }
            />
          </div>

          {answer.comments?.trim() && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Reviewer Comment
              </p>

              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">
                {answer.comments}
              </p>
            </div>
          )}

          {previousAnswer &&
            previousState && (
              <PreviousAttemptInsight
                previousAttemptNumber={
                  previousAttemptNumber
                }
                previousState={
                  previousState
                }
                currentState={
                  state
                }
                improvement={
                  improvement
                }
              />
            )}

          {answer.scoreHistory &&
            answer.scoreHistory.length >
              0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Score History
                </p>

                <div className="mt-2 space-y-2">
                  {answer.scoreHistory.map(
                    (
                      entry,
                      index
                    ) => (
                      <div
                        key={`${entry.timestamp}-${index}`}
                        className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      >
                        Changed to{" "}
                        <strong>
                          {
                            entry.marks
                          }
                          /
                          {
                            answer.maxMarks
                          }
                        </strong>
                        {" · "}
                        {
                          entry.reason
                        }
                        {" · "}
                        {formatDateTime(
                          entry.timestamp
                        )}
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   PREVIOUS ATTEMPT INSIGHT
   ========================================================= */

function PreviousAttemptInsight({
  previousAttemptNumber,
  previousState,
  currentState,
  improvement,
}: {
  previousAttemptNumber?: number;
  previousState: AnswerState;
  currentState: AnswerState;
  improvement: number | null;
}) {
  let message =
    "Performance unchanged.";

  if (
    previousState !==
      "correct" &&
    currentState === "correct"
  ) {
    message =
      "This mistake was corrected in the current attempt.";
  } else if (
    previousState ===
      "correct" &&
    currentState !== "correct"
  ) {
    message =
      "This question regressed after being correct previously.";
  } else if (
    improvement !== null &&
    improvement > 0
  ) {
    message = `Improved by ${improvement} mark${
      improvement === 1
        ? ""
        : "s"
    } from the previous attempt.`;
  } else if (
    improvement !== null &&
    improvement < 0
  ) {
    message = `Dropped by ${Math.abs(
      improvement
    )} mark${
      Math.abs(improvement) ===
      1
        ? ""
        : "s"
    } from the previous attempt.`;
  }

  return (
    <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-900/50 dark:bg-blue-950/20">
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
        Attempt Progression
      </p>

      <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
        Attempt #
        {previousAttemptNumber ??
          "?"}
        {" → "}
        {message}
      </p>
    </div>
  );
}

/* =========================================================
   ATTEMPT STATUS BADGE
   ========================================================= */

function AttemptStatusBadge({
  attempt,
  exam,
}: {
  attempt: ExamAttempt;
  exam: Exam;
}) {
  const perfect =
    attempt.status ===
      "reviewed" &&
    Boolean(
      attempt.maxTotalMarks
    ) &&
    attempt.totalMarks ===
      attempt.maxTotalMarks;

  if (perfect) {
    return (
      <Badge color="green">
        Perfect
      </Badge>
    );
  }

  if (
    attempt.status ===
    "reviewed"
  ) {
    if (
      exam.mode === "normal"
    ) {
      return (
        <Badge color="green">
          Completed
        </Badge>
      );
    }

    return (
      <Badge color="red">
        Re-Exam Required
      </Badge>
    );
  }

  if (
    attempt.status ===
    "review_in_progress"
  ) {
    return (
      <Badge color="amber">
        Review In Progress
      </Badge>
    );
  }

  if (
    attempt.status ===
    "submitted"
  ) {
    return (
      <Badge color="amber">
        Needs Review
      </Badge>
    );
  }

  return (
    <Badge color="brand">
      In Progress
    </Badge>
  );
}

/* =========================================================
   ANSWER STATE
   ========================================================= */

function getAnswerState(
  answer: AttemptAnswer
): AnswerState {
  if (
    answer.marks === undefined
  ) {
    return "unscored";
  }

  if (
    answer.maxMarks <= 0
  ) {
    return "unscored";
  }

  const percentage =
    answer.marks /
    answer.maxMarks;

  if (percentage >= 0.7) {
    return "correct";
  }

  if (answer.marks > 0) {
    return "improvement";
  }

  return "incorrect";
}

function getAnswerStateLabel(
  state: AnswerState
) {
  switch (state) {
    case "correct":
      return "Correct";

    case "improvement":
      return "Needs Improvement";

    case "incorrect":
      return "Incorrect";

    case "unscored":
      return "Unscored";
  }
}

function AnswerStateBadge({
  state,
}: {
  state: AnswerState;
}) {
  if (state === "correct") {
    return (
      <span className="rounded-full bg-green-100 px-2 py-1 text-[11px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
        Correct
      </span>
    );
  }

  if (
    state === "improvement"
  ) {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        Needs Improvement
      </span>
    );
  }

  if (
    state === "incorrect"
  ) {
    return (
      <span className="rounded-full bg-red-100 px-2 py-1 text-[11px] font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
        Incorrect
      </span>
    );
  }

  return (
    <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      Unscored
    </span>
  );
}

/* =========================================================
   UI HELPERS
   ========================================================= */

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}

        <p className="text-xs font-medium">
          {label}
        </p>
      </div>

      <p className="mt-2 text-2xl font-semibold">
        {value}
      </p>
    </div>
  );
}

function ModalStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
      <p className="text-xs text-slate-500">
        {label}
      </p>

      <p className="mt-1 truncate font-semibold">
        {value}
      </p>
    </div>
  );
}

function AnswerSummary({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone:
    | "green"
    | "amber"
    | "red"
    | "slate";
}) {
  const classes = {
    green:
      "border-green-100 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-950/20 dark:text-green-400",
    amber:
      "border-amber-100 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400",
    red:
      "border-red-100 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400",
    slate:
      "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };

  return (
    <div
      className={`rounded-xl border p-4 ${classes[tone]}`}
    >
      <div className="flex items-center gap-2">
        {icon}

        <span className="text-xs font-medium">
          {label}
        </span>
      </div>

      <p className="mt-2 text-2xl font-semibold">
        {value}
      </p>
    </div>
  );
}

function AnswerBox({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant:
    | "agent"
    | "expected";
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">
        {value}
      </p>
    </div>
  );
}

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-slate-100/70 p-3 dark:bg-slate-800">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>

      <p className="mt-1 text-sm font-medium">
        {value}
      </p>
    </div>
  );
}

function getQuestionBorderClass(
  state: AnswerState
) {
  switch (state) {
    case "correct":
      return "border-green-200 dark:border-green-900/50";

    case "improvement":
      return "border-amber-200 dark:border-amber-900/50";

    case "incorrect":
      return "border-red-200 dark:border-red-900/50";

    case "unscored":
      return "border-slate-200 dark:border-slate-700";
  }
}

/* =========================================================
   CALCULATIONS
   ========================================================= */

function calculateDraftPercentage(
  answers: AttemptAnswer[]
): number | null {
  const scored =
    answers.filter(
      (answer) =>
        answer.marks !==
        undefined
    );

  if (scored.length === 0) {
    return null;
  }

  const marks =
    scored.reduce(
      (sum, answer) =>
        sum +
        (answer.marks ?? 0),
      0
    );

  const max =
    scored.reduce(
      (sum, answer) =>
        sum +
        answer.maxMarks,
      0
    );

  if (max <= 0) {
    return null;
  }

  return Math.round(
    (marks / max) * 100
  );
}

function calculateAnswerImprovement(
  previous:
    | AttemptAnswer
    | undefined,
  current: AttemptAnswer
): number | null {
  if (
    !previous ||
    previous.marks ===
      undefined ||
    current.marks ===
      undefined
  ) {
    return null;
  }

  return (
    current.marks -
    previous.marks
  );
}

/* =========================================================
   FORMATTERS
   ========================================================= */

function formatDuration(
  seconds: number
) {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes =
    Math.floor(seconds / 60);

  const remainingSeconds =
    seconds % 60;

  if (minutes < 60) {
    return remainingSeconds
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours =
    Math.floor(minutes / 60);

  const remainingMinutes =
    minutes % 60;

  return `${hours}h ${remainingMinutes}m`;
}

function formatDateTime(
  timestamp: number
) {
  return new Date(
    timestamp
  ).toLocaleString();
}