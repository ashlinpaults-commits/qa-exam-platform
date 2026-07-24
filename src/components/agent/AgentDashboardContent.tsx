"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { fetchAssignedExams } from "@/lib/exams";
import { fetchAttemptsForAgent } from "@/lib/attempts";
import type { Exam, ExamAttempt } from "@/types";
import {
  Badge,
  EmptyState,
} from "@/components/ui/Primitives";
import {
  TrendingUp,
  TrendingDown,
} from "lucide-react";

export function AgentDashboardContent() {
  const { profile } = useAuth();

  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * Load the dashboard from Firestore.
   *
   * Attempts are deduplicated by Firestore document ID so the
   * same document can never accidentally appear twice in state.
   */
  const loadDashboard = useCallback(async () => {
    if (!profile?.uid) return;

    try {
      setLoading(true);

      const [examData, attemptData] = await Promise.all([
        fetchAssignedExams(profile.uid),
        fetchAttemptsForAgent(profile.uid),
      ]);

      const uniqueAttempts = Array.from(
        new Map(
          attemptData.map((attempt) => [
            attempt.id,
            attempt,
          ])
        ).values()
      );

      setExams(examData);
      setAttempts(uniqueAttempts);
    } catch (error) {
      console.error(
        "Failed to load agent dashboard:",
        error
      );
    } finally {
      setLoading(false);
    }
  }, [profile?.uid]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (loading) {
    return (
      <p className="text-sm text-slate-400">
        Loading...
      </p>
    );
  }

  /**
   * -------------------------------------------------------
   * ATTEMPT STATES
   * -------------------------------------------------------
   *
   * These groups are deliberately mutually exclusive.
   *
   * in_progress       -> Continue exam
   * submitted         -> Awaiting auditor
   * review_in_progress-> Auditor reviewing
   * reviewed          -> Official completed attempt
   */

  const inProgress = attempts.filter(
    (attempt) => attempt.status === "in_progress"
  );

  const awaitingReview = attempts.filter(
    (attempt) =>
      attempt.status === "submitted" ||
      attempt.status === "review_in_progress"
  );

  const reviewed = attempts.filter(
    (attempt) =>
      attempt.status === "reviewed" &&
      Boolean(attempt.maxTotalMarks)
  );

  const completed = attempts.filter(
    (attempt) => attempt.status === "reviewed"
  );

  /**
   * -------------------------------------------------------
   * PERFORMANCE SUMMARY
   * -------------------------------------------------------
   */

  const overallScorePct = reviewed.length
    ? Math.round(
        (reviewed.reduce(
          (sum, attempt) =>
            sum +
            (attempt.totalMarks ?? 0) /
              (attempt.maxTotalMarks ?? 1),
          0
        ) /
          reviewed.length) *
          100
      )
    : 0;

  const perfectExams = reviewed.filter(
    (attempt) =>
      attempt.totalMarks === attempt.maxTotalMarks
  ).length;

  const examScoreByExam: Record<
    string,
    {
      total: number;
      max: number;
    }
  > = {};

  reviewed.forEach((attempt) => {
    const exam = exams.find(
      (item) => item.id === attempt.examId
    );

    if (!exam) return;

    const current = examScoreByExam[exam.name] ?? {
      total: 0,
      max: 0,
    };

    current.total += attempt.totalMarks ?? 0;
    current.max += attempt.maxTotalMarks ?? 0;

    examScoreByExam[exam.name] = current;
  });

  const ranked = Object.entries(examScoreByExam)
    .map(([name, values]) => ({
      name,
      pct: values.max
        ? values.total / values.max
        : 0,
    }))
    .sort((a, b) => a.pct - b.pct);

  const weak = ranked
    .slice(0, 2)
    .map((item) => item.name);

  const strong = ranked
    .slice(-2)
    .map((item) => item.name)
    .reverse();

  /**
   * Improvement indicator.
   */

  const recent = [...reviewed]
    .sort(
      (a, b) =>
        (a.reviewedAt ?? 0) -
        (b.reviewedAt ?? 0)
    )
    .slice(-3);

  const improving =
    recent.length >= 2 &&
    (recent[recent.length - 1].totalMarks ?? 0) /
      (recent[recent.length - 1].maxTotalMarks ??
        1) >
      (recent[0].totalMarks ?? 0) /
        (recent[0].maxTotalMarks ?? 1);

  /**
   * -------------------------------------------------------
   * EXAMS AVAILABLE TO START / RETRY
   * -------------------------------------------------------
   */

  const assignedNotStarted = exams.filter((exam) => {
    const examAttempts = attempts.filter(
      (attempt) => attempt.examId === exam.id
    );

    /**
     * Brand-new exam.
     */
    if (examAttempts.length === 0) {
      return true;
    }

    /**
     * CRITICAL:
     * Never allow another attempt while ANY attempt for this
     * exam is currently active or waiting for review.
     */
    const hasOpenAttempt = examAttempts.some(
      (attempt) =>
        attempt.status === "in_progress" ||
        attempt.status === "submitted" ||
        attempt.status === "review_in_progress"
    );

    if (hasOpenAttempt) {
      return false;
    }

    /**
     * Normal exams do not retry.
     */
    if (exam.mode !== "until_perfect") {
      return false;
    }

    /**
     * Determine latest official reviewed attempt.
     */
    const reviewedAttempts = examAttempts
      .filter(
        (attempt) => attempt.status === "reviewed"
      )
      .sort(
        (a, b) =>
          b.attemptNumber - a.attemptNumber
      );

    const latestReviewed = reviewedAttempts[0];

    if (!latestReviewed) {
      return false;
    }

    if (!latestReviewed.maxTotalMarks) {
      return false;
    }

    /**
     * Perfect 10:
     * Retry only if latest official score was below perfect.
     */
    return (
      latestReviewed.totalMarks !==
      latestReviewed.maxTotalMarks
    );
  });

  return (
    <div className="space-y-6">
      {/* PERFORMANCE OVERVIEW */}

      <div className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">
              {profile?.name}
            </h1>

            <p className="text-sm text-slate-500">
              Your performance overview
            </p>
          </div>

          {reviewed.length > 0 && (
            <Badge
              color={improving ? "green" : "slate"}
            >
              {improving ? (
                <TrendingUp className="mr-1 inline h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="mr-1 inline h-3.5 w-3.5" />
              )}

              {improving ? "Improving" : "Steady"}
            </Badge>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat
            label="Overall Score"
            value={`${overallScorePct}%`}
          />

          <Stat
            label="Attempts"
            value={String(attempts.length)}
          />

          <Stat
            label="Perfect Exams"
            value={String(perfectExams)}
          />

          <Stat
            label="Assigned"
            value={String(exams.length)}
          />
        </div>

        {(weak.length > 0 || strong.length > 0) && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Weak Areas
              </p>

              <ul className="text-sm">
                {weak.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>

            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Strong Areas
              </p>

              <ul className="text-sm">
                {strong.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      {/* AVAILABLE / RETEST EXAMS */}

      <div>
        <h2 className="mb-2 font-semibold">
          Assigned Exams
        </h2>

        {assignedNotStarted.length === 0 ? (
          <EmptyState
            title="Nothing new to take"
            subtitle="Check back once your auditor assigns a new exam or a re-exam becomes available."
          />
        ) : (
          <div className="space-y-2">
            {assignedNotStarted.map((exam) => {
              const examAttempts = attempts
                .filter(
                  (attempt) =>
                    attempt.examId === exam.id
                )
                .sort(
                  (a, b) =>
                    b.attemptNumber -
                    a.attemptNumber
                );

              const latestReviewed =
                examAttempts
                  .filter(
                    (attempt) =>
                      attempt.status === "reviewed"
                  )
                  .sort(
                    (a, b) =>
                      b.attemptNumber -
                      a.attemptNumber
                  )[0];

              const isRetest =
                exam.mode === "until_perfect" &&
                Boolean(latestReviewed) &&
                Boolean(
                  latestReviewed?.maxTotalMarks
                ) &&
                latestReviewed?.totalMarks !==
                  latestReviewed?.maxTotalMarks;

              const highestAttemptNumber =
                examAttempts.length > 0
                  ? Math.max(
                      ...examAttempts.map(
                        (attempt) =>
                          attempt.attemptNumber
                      )
                    )
                  : 0;

              const nextAttemptNumber =
                highestAttemptNumber + 1;

              return (
                <div
                  key={exam.id}
                  className="card flex items-center justify-between gap-4 p-4"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {exam.name}
                      </p>

                      {isRetest && (
                        <Badge color="amber">
                          Re-Exam Required
                        </Badge>
                      )}
                    </div>

                    <p className="mt-1 text-sm text-slate-500">
                      {exam.questions.length} questions
                      {" · "}
                      {exam.mode === "until_perfect"
                        ? "Perfect 10"
                        : "Normal"}
                    </p>

                    {isRetest &&
                      latestReviewed && (
                        <p className="mt-1 text-sm font-medium text-amber-600 dark:text-amber-400">
                          Attempt #
                          {nextAttemptNumber}
                          {" · "}
                          Previous score:{" "}
                          {latestReviewed.totalMarks}/
                          {
                            latestReviewed.maxTotalMarks
                          }
                        </p>
                      )}
                  </div>

                  <Link
                    href={`/agent/exams/${exam.id}/take`}
                    className="btn-primary"
                  >
                    {isRetest
                      ? `Start Attempt #${nextAttemptNumber}`
                      : "Start Exam"}
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* IN PROGRESS */}

      {inProgress.length > 0 && (
        <div>
          <h2 className="mb-2 font-semibold">
            In Progress
          </h2>

          <div className="space-y-2">
            {inProgress.map((attempt) => {
              const exam = exams.find(
                (item) =>
                  item.id === attempt.examId
              );

              return (
                <div
                  key={attempt.id}
                  className="card flex items-center justify-between gap-4 p-4"
                >
                  <div>
                    <p className="font-medium">
                      {exam?.name ?? "Exam"} — Attempt #
                      {attempt.attemptNumber}
                    </p>

                    <p className="mt-1 text-sm text-slate-500">
                      Continue where you left off.
                    </p>
                  </div>

                  <Link
                    href={`/agent/exams/${attempt.examId}/take`}
                    className="btn-secondary"
                  >
                    Continue
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* AWAITING REVIEW */}

      {awaitingReview.length > 0 && (
        <div>
          <h2 className="mb-2 font-semibold">
            Awaiting Review
          </h2>

          <div className="space-y-2">
            {awaitingReview.map((attempt) => {
              const exam = exams.find(
                (item) =>
                  item.id === attempt.examId
              );

              return (
                <div
                  key={attempt.id}
                  className="card flex items-center justify-between gap-4 p-4"
                >
                  <div>
                    <p className="font-medium">
                      {exam?.name ?? "Exam"} — Attempt #
                      {attempt.attemptNumber}
                    </p>

                    <p className="mt-1 text-sm text-slate-500">
                      {attempt.status ===
                      "review_in_progress"
                        ? "Your auditor is currently reviewing this attempt."
                        : "Submitted and waiting for auditor review."}
                    </p>
                  </div>

                  <Badge color="amber">
                    {attempt.status ===
                    "review_in_progress"
                      ? "Under Review"
                      : "Needs Review"}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* COMPLETED */}

      {completed.length > 0 && (
        <div>
          <h2 className="mb-2 font-semibold">
            Completed Attempts
          </h2>

          <div className="space-y-2">
            {completed
              .sort(
                (a, b) =>
                  (b.reviewedAt ?? 0) -
                  (a.reviewedAt ?? 0)
              )
              .map((attempt) => {
                const exam = exams.find(
                  (item) =>
                    item.id === attempt.examId
                );

                const perfect =
                  Boolean(attempt.maxTotalMarks) &&
                  attempt.totalMarks ===
                    attempt.maxTotalMarks;

                return (
                  <div
                    key={attempt.id}
                    className="card flex items-center justify-between gap-4 p-4"
                  >
                    <div>
                      <p className="font-medium">
                        {exam?.name ?? "Exam"} — Attempt #
                        {attempt.attemptNumber}
                      </p>

                      <p className="mt-1 text-sm text-slate-500">
                        Review completed
                      </p>
                    </div>

                    {attempt.maxTotalMarks ? (
                      <Badge
                        color={
                          perfect
                            ? "green"
                            : "brand"
                        }
                      >
                        {attempt.totalMarks ?? 0}/
                        {attempt.maxTotalMarks}
                      </Badge>
                    ) : (
                      <Badge color="slate">
                        Reviewed
                      </Badge>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-2xl font-semibold">
        {value}
      </p>

      <p className="text-xs text-slate-500">
        {label}
      </p>
    </div>
  );
}