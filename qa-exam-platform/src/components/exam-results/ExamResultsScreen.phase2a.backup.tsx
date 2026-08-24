"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  X,
  Clock3,
  ClipboardCheck,
  Users,
  RotateCcw,
  ArrowLeft,
} from "lucide-react";

import { getExam } from "@/lib/exams";
import { fetchAttemptsForExam } from "@/lib/attempts";
import { fetchAllUsers } from "@/lib/users";

import type {
  AppUser,
  Exam,
  ExamAttempt,
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

export function ExamResultsScreen({
  examId,
}: Props) {
  const [exam, setExam] = useState<Exam | null>(
    null
  );

  const [attempts, setAttempts] = useState<
    ExamAttempt[]
  >([]);

  const [users, setUsers] = useState<AppUser[]>(
    []
  );

  const [loading, setLoading] = useState(true);

  const [selectedAttempt, setSelectedAttempt] =
    useState<ExamAttempt | null>(null);

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

  const agentResults =
    useMemo<AgentResult[]>(() => {
      if (!exam) return [];

      /*
       * Include both:
       *
       * 1. Agents assigned to the exam.
       * 2. Agents with historical attempts.
       *
       * This prevents old results disappearing if
       * assignments are changed later.
       */
      const agentIds = new Set<string>([
        ...exam.assignedAgentIds,
        ...attempts.map(
          (attempt) => attempt.agentId
        ),
      ]);

      return Array.from(agentIds)
        .map((agentId) => {
          const agentAttempts = attempts
            .filter(
              (attempt) =>
                attempt.agentId === agentId
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
                attempt.status === "reviewed"
            );

          const latestReviewed =
            reviewedAttempts[
              reviewedAttempts.length - 1
            ];

          const completed =
            exam.mode === "until_perfect"
              ? Boolean(
                  latestReviewed &&
                    latestReviewed.maxTotalMarks &&
                    latestReviewed.totalMarks ===
                      latestReviewed.maxTotalMarks
                )
              : reviewedAttempts.length > 0;

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

        <Link
          href={`/auditor/exams/${exam.id}/review`}
          className="btn-primary"
        >
          Review Attempts
        </Link>
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
          value={String(completedAgents)}
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
          value={String(pendingReview)}
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
                  Attempt history and competency status for this exam.
                </p>
              </div>

              <span className="text-xs text-slate-400">
                {totalReviewedAttempts} reviewed attempts
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
                      key={result.agentId}
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

      {/* PHASE 2B PREVIEW MODAL */}

      {selectedAttempt && (
        <AttemptPreview
          attempt={selectedAttempt}
          agentName={
            users.find(
              (user) =>
                user.uid ===
                selectedAttempt.agentId
            )?.name ??
            selectedAttempt.agentId
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
            —
          </span>
        )}
      </td>

      <td className="px-5 py-4 text-sm">
        {latest?.timeTakenSeconds
          ? formatDuration(
              latest.timeTakenSeconds
            )
          : "—"}
      </td>

      <td className="px-5 py-4 text-sm text-slate-500">
        {result.latestReviewed
          ?.reviewedAt
          ? new Date(
              result.latestReviewed
                .reviewedAt
            ).toLocaleDateString()
          : "—"}
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
    attempt.status === "reviewed" &&
    Boolean(attempt.maxTotalMarks) &&
    attempt.totalMarks ===
      attempt.maxTotalMarks;

  const reviewedFail =
    attempt.status === "reviewed" &&
    !perfect;

  let label = `Attempt #${attempt.attemptNumber}`;

  if (perfect) {
    label += " - Complete";
  } else if (reviewedFail) {
    label += " - Below target";
  } else if (
    attempt.status === "submitted"
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

  /*
   * For Normal exams, any reviewed attempt is
   * considered completed even if it isn't perfect.
   */
  const normalComplete =
    exam.mode === "normal" &&
    attempt.status === "reviewed";

  if (perfect || normalComplete) {
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
    attempt.status === "submitted" ||
    attempt.status ===
      "review_in_progress"
  ) {
    return (
      <button
        type="button"
        title={label}
        aria-label={label}
        onClick={onClick}
        className="flex h-8 w-8 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-sm font-bold text-amber-700 transition hover:scale-105 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400"
      >
        •
      </button>
    );
  }

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-sm text-slate-500 transition hover:scale-105 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
    >
      ◌
    </button>
  );
}

/* =========================================================
   STATUS
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
   TEMPORARY ATTEMPT PREVIEW
   ========================================================= */

/**
 * This is intentionally lightweight for Phase 2A.
 *
 * Phase 2B will replace the contents with the full:
 *
 * score
 * percentage
 * wrong answers
 * knowledge gaps
 * reviewer comments
 * mistake progression
 */
function AttemptPreview({
  attempt,
  agentName,
  onClose,
}: {
  attempt: ExamAttempt;
  agentName: string;
  onClose: () => void;
}) {
  const score =
    attempt.totalMarks !==
      undefined &&
    attempt.maxTotalMarks
      ? `${attempt.totalMarks}/${attempt.maxTotalMarks}`
      : "Not finalized";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900"
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Attempt #
              {attempt.attemptNumber}
            </p>

            <h3 className="mt-1 text-lg font-semibold">
              {agentName}
            </h3>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <MiniStat
            label="Status"
            value={formatStatus(
              attempt.status
            )}
          />

          <MiniStat
            label="Score"
            value={score}
          />

          <MiniStat
            label="Time"
            value={
              attempt.timeTakenSeconds
                ? formatDuration(
                    attempt.timeTakenSeconds
                  )
                : "—"
            }
          />

          <MiniStat
            label="Questions"
            value={String(
              attempt.answers.length
            )}
          />
        </div>

        <p className="mt-5 text-xs text-slate-500">
          Detailed wrong-answer analysis will be added in Phase 2B.
        </p>
      </div>
    </div>
  );
}

/* =========================================================
   SMALL COMPONENTS
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

function MiniStat({
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

      <p className="mt-1 font-semibold">
        {value}
      </p>
    </div>
  );
}

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

function formatStatus(
  status: ExamAttempt["status"]
) {
  switch (status) {
    case "in_progress":
      return "In Progress";

    case "submitted":
      return "Needs Review";

    case "review_in_progress":
      return "Under Review";

    case "reviewed":
      return "Reviewed";

    default:
      return status;
  }
}