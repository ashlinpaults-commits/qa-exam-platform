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
  FileText,
  RotateCcw,
} from "lucide-react";
import { AgentScorecardModal } from "./AgentScorecardModal";
import { deriveCleanTitle } from "@/components/exam-builder/ExamListScreen";

export function AgentDashboardContent() {
  const { profile } = useAuth();

  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAttemptForModal, setSelectedAttemptForModal] = useState<ExamAttempt | null>(null);

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

  /**
   * Group reviewed attempts by examId to isolate authoritative latest attempts.
   * This prevents multiple reattempts for the same exam from distorting competency.
   */
  const reviewedByExam = new Map<string, ExamAttempt[]>();
  for (const attempt of reviewed) {
    if (!attempt.examId) continue;
    const list = reviewedByExam.get(attempt.examId) || [];
    list.push(attempt);
    reviewedByExam.set(attempt.examId, list);
  }

  const authoritativeReviewedAttempts: ExamAttempt[] = [];
  for (const [, examAttempts] of reviewedByExam.entries()) {
    // Sort descending by attemptNumber, then reviewedAt/startedAt timestamp
    const sorted = [...examAttempts].sort(
      (a, b) =>
        (b.attemptNumber ?? 0) - (a.attemptNumber ?? 0) ||
        (b.reviewedAt ?? 0) - (a.reviewedAt ?? 0) ||
        (b.startedAt ?? 0) - (a.startedAt ?? 0)
    );
    if (sorted.length > 0) {
      authoritativeReviewedAttempts.push(sorted[0]);
    }
  }

  // Calculate overall competency using ONE authoritative result per unique exam
  const totalCompetencyPct = authoritativeReviewedAttempts.reduce((sum, attempt) => {
    const total = attempt.totalMarks ?? 0;
    const max = attempt.maxTotalMarks ?? 0;
    if (max <= 0) return sum;
    const pct = total / max;
    return sum + (Number.isFinite(pct) ? pct : 0);
  }, 0);

  const overallScorePct = authoritativeReviewedAttempts.length > 0
    ? Math.round((totalCompetencyPct / authoritativeReviewedAttempts.length) * 100)
    : 0;

  const perfectExams = authoritativeReviewedAttempts.filter(
    (attempt) =>
      Boolean(attempt.maxTotalMarks) &&
      attempt.maxTotalMarks! > 0 &&
      attempt.totalMarks === attempt.maxTotalMarks
  ).length;

  /**
   * Evaluate Strong Areas (>= 85%) and Weak Areas (< 70%) per unique exam.
   * Uses authoritative attempt per exam and enforces mutual exclusivity.
   */
  const examCompetencies: { name: string; pct: number }[] = [];

  for (const attempt of authoritativeReviewedAttempts) {
    const exam = exams.find((item) => item.id === attempt.examId);
    if (!exam) continue;

    const max = attempt.maxTotalMarks ?? 0;
    if (max <= 0) continue;
    const total = attempt.totalMarks ?? 0;
    const pct = total / max;
    if (!Number.isFinite(pct)) continue;

    const cleanTitle = deriveCleanTitle(exam, 0).title;
    examCompetencies.push({
      name: cleanTitle,
      pct,
    });
  }

  // Strong: ONLY >= 85% (0.85), sorted highest first, limit to at most 2 items
  const strongQualifying = examCompetencies
    .filter((item) => item.pct >= 0.85)
    .sort((a, b) => b.pct - a.pct);
  const strong = strongQualifying.slice(0, 2).map((item) => item.name);
  const strongSet = new Set(strong);

  // Weak: ONLY < 70% (0.70), mutually exclusive (!strongSet.has), sorted lowest first, limit to at most 2 items
  const weakQualifying = examCompetencies
    .filter((item) => item.pct < 0.70 && !strongSet.has(item.name))
    .sort((a, b) => a.pct - b.pct);
  const weak = weakQualifying.slice(0, 2).map((item) => item.name);

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
     * If auditor granted explicit reattempt permission, it is available to take.
     */
    const hasReattemptPermission = Boolean(profile?.uid && exam.reattemptPermissions?.[profile.uid]);
    if (hasReattemptPermission) {
      return true;
    }

    /**
     * Normal exams do not retry without explicit permission.
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
            {weak.length > 0 && (
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
            )}

            {strong.length > 0 && (
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
            )}
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
            {assignedNotStarted.map((exam, index) => {
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

              const hasReattemptPermission = Boolean(profile?.uid && exam.reattemptPermissions?.[profile.uid]);

              const cleanTitle = deriveCleanTitle(exam, index).title;

              return (
                <div
                  key={exam.id}
                  className="card flex items-center justify-between gap-4 p-4"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {cleanTitle}
                      </p>

                      {isRetest && (
                        <Badge color="amber">
                          Re-Exam Required
                        </Badge>
                      )}

                      {hasReattemptPermission && !isRetest && (
                        <Badge color="brand">
                          Reattempt Authorized
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

                    {(isRetest || hasReattemptPermission) &&
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
                    {isRetest || hasReattemptPermission
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

              const cleanTitle = exam ? deriveCleanTitle(exam, 0).title : "Exam";

              return (
                <div
                  key={attempt.id}
                  className="card flex items-center justify-between gap-4 p-4"
                >
                  <div>
                    <p className="font-medium">
                      {cleanTitle} — Attempt #
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

              const cleanTitle = exam ? deriveCleanTitle(exam, 0).title : "Exam";

              return (
                <div
                  key={attempt.id}
                  className="card flex items-center justify-between gap-4 p-4"
                >
                  <div>
                    <p className="font-medium">
                      {cleanTitle} — Attempt #
                      {attempt.attemptNumber}
                    </p>

                    <p className="mt-1 text-sm text-slate-500">
                      {attempt.status ===
                      "review_in_progress"
                        ? "Your auditor is currently reviewing this attempt."
                        : "Submitted and waiting for auditor review."}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => setSelectedAttemptForModal(attempt)}
                    >
                      View Answers
                    </button>
                    <Badge color="amber">
                      {attempt.status ===
                      "review_in_progress"
                        ? "Under Review"
                        : "Needs Review"}
                    </Badge>
                  </div>
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

                const cleanTitle = exam ? deriveCleanTitle(exam, 0).title : "Exam";

                return (
                  <div
                    key={attempt.id}
                    className="card flex items-center justify-between gap-4 p-4"
                  >
                    <div>
                      <p className="font-medium">
                        {cleanTitle} — Attempt #
                        {attempt.attemptNumber}
                      </p>

                      <p className="mt-1 text-sm text-slate-500">
                        Review completed
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn-secondary flex items-center gap-1.5 text-xs shadow-sm"
                        onClick={() => setSelectedAttemptForModal(attempt)}
                      >
                        <FileText className="h-3.5 w-3.5 text-brand-600" />
                        View Scorecard
                      </button>

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
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Agent Scorecard & Submitted Answers Modal */}
      {selectedAttemptForModal && (
        <AgentScorecardModal
          open={!!selectedAttemptForModal}
          onClose={() => setSelectedAttemptForModal(null)}
          attempt={selectedAttemptForModal}
          examName={
            exams.find((e) => e.id === selectedAttemptForModal.examId)
              ? deriveCleanTitle(exams.find((e) => e.id === selectedAttemptForModal.examId)!, 0).title
              : "Exam"
          }
          questionSnapshots={exams.find((e) => e.id === selectedAttemptForModal.examId)?.questionSnapshots}
        />
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