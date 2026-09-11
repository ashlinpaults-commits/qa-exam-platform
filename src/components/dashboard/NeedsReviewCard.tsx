"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, FileCheck2 } from "lucide-react";
import type { ExamAttempt, Exam, AppUser } from "@/types";

interface NeedsReviewCardProps {
  attempts: ExamAttempt[];
  exams: Exam[];
  users: AppUser[];
  loading?: boolean;
}

function formatSubmissionAge(timestamp?: number): string {
  if (!timestamp) return "Recently";
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function NeedsReviewCard({
  attempts,
  exams,
  users,
  loading = false,
}: NeedsReviewCardProps) {
  const examMap = new Map(exams.map((e) => [e.id, e.name]));
  const userMap = new Map(users.map((u) => [u.uid, u.name]));

  const pendingAttempts = attempts.filter(
    (a) => a.status === "submitted" || a.status === "review_in_progress"
  );

  const displayList = pendingAttempts.slice(0, 5);
  const firstExamId = displayList[0]?.examId;

  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-shadow hover:shadow-card-hover dark:border-slate-800 dark:bg-slate-900">
      <div>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/60 dark:text-brand-400">
                <FileCheck2 className="h-3.5 w-3.5" />
              </span>
              <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                Needs Review
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Attempts awaiting your evaluation and score approval
            </p>
          </div>

          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700 dark:border-brand-800/80 dark:bg-brand-950/50 dark:text-brand-300">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-600 animate-pulse dark:bg-brand-400" />
            {pendingAttempts.length} Pending
          </span>
        </div>

        {/* Content List */}
        <div className="mt-3 divide-y divide-slate-100 dark:divide-slate-800/60">
          {loading ? (
            <div className="space-y-3 py-4">
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-center justify-between gap-4 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-slate-100 dark:bg-slate-800" />
                    <div className="space-y-1.5">
                      <div className="h-3.5 w-28 rounded bg-slate-100 dark:bg-slate-800" />
                      <div className="h-3 w-40 rounded bg-slate-100 dark:bg-slate-800" />
                    </div>
                  </div>
                  <div className="h-8 w-16 rounded bg-slate-100 dark:bg-slate-800" />
                </div>
              ))}
            </div>
          ) : displayList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <p className="mt-2.5 text-sm font-semibold text-slate-800 dark:text-slate-200">
                All caught up!
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                No trainee attempts are currently waiting for auditor review.
              </p>
            </div>
          ) : (
            displayList.map((att) => {
              const agentName = userMap.get(att.agentId) || "Trainee Agent";
              const examName = examMap.get(att.examId) || "Assessment Exam";
              const timeDisplay = formatSubmissionAge(att.submittedAt || att.startedAt);
              const isInProgress = att.status === "review_in_progress";

              return (
                <div
                  key={att.id}
                  className="group flex flex-wrap items-center justify-between gap-3 py-3 transition hover:bg-slate-50/70 dark:hover:bg-slate-800/30 rounded-xl px-2"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 font-bold text-xs uppercase dark:bg-slate-800 dark:text-slate-300">
                      {agentName.slice(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-xs font-semibold text-slate-900 dark:text-white">
                          {agentName}
                        </p>
                        {att.isReattempt && (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.2 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                            Retake
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {examName}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="hidden sm:flex flex-col items-end text-right">
                      <span
                        className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                          isInProgress
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
                        }`}
                      >
                        {isInProgress ? "In Progress" : "Awaiting Review"}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400">
                        <Clock className="h-2.5 w-2.5" />
                        {timeDisplay}
                      </span>
                    </div>

                    <Link
                      href={`/auditor/exams/${att.examId}/review`}
                      className="inline-flex items-center gap-1 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-bold text-brand-700 transition hover:bg-brand-600 hover:text-white active:scale-[0.97] dark:bg-brand-950/60 dark:text-brand-300 dark:hover:bg-brand-600 dark:hover:text-white"
                    >
                      <span>Review</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Footer link */}
      {pendingAttempts.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Link
            href={firstExamId ? `/auditor/exams/${firstExamId}/review` : "/auditor/exams"}
            className="group inline-flex items-center gap-1 text-xs font-semibold text-brand-600 transition hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            <span>View all in Review Queue</span>
            <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
