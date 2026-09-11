"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, RotateCcw } from "lucide-react";
import type { ExamAttempt, Exam, AppUser } from "@/types";

interface ContinueCardProps {
  attempts: ExamAttempt[];
  exams: Exam[];
  users: AppUser[];
  currentUserId?: string;
  loading?: boolean;
}

export function ContinueCard({
  attempts,
  exams,
  users,
  currentUserId,
  loading = false,
}: ContinueCardProps) {
  const examMap = new Map(exams.map((e) => [e.id, e.name]));
  const userMap = new Map(users.map((u) => [u.uid, u.name]));

  // Priority 1: Unfinished review in progress by current auditor, or latest in progress
  const inProgressList = attempts.filter((a) => a.status === "review_in_progress");
  const myInProgress = currentUserId
    ? inProgressList.find((a) => a.reviewedBy === currentUserId)
    : undefined;
  const targetInProgress = myInProgress || inProgressList[0];

  // Priority 2: Submitted attempt waiting for review
  const nextSubmitted = !targetInProgress
    ? attempts.find((a) => a.status === "submitted")
    : undefined;

  const targetAttempt = targetInProgress || nextSubmitted;

  if (loading) {
    return (
      <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-32 rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-6 w-48 rounded bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-28 rounded bg-slate-100 dark:bg-slate-800" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-shadow hover:shadow-card-hover dark:border-slate-800 dark:bg-slate-900">
      <div>
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-slate-100 pb-4 dark:border-slate-800">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
            <RotateCcw className="h-3.5 w-3.5" />
          </span>
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
              Continue Where You Left Off
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Resume your most recent assessment or grading task
            </p>
          </div>
        </div>

        {/* Card Body */}
        <div className="mt-4">
          {!targetAttempt ? (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
              </span>
              <p className="mt-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                All activities complete
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                No unfinished reviews or urgent tasks pending.
              </p>
            </div>
          ) : (
            (() => {
              const examName = examMap.get(targetAttempt.examId) || "Assessment Exam";
              const agentName = userMap.get(targetAttempt.agentId) || "Trainee Agent";
              const answers = targetAttempt.answers || [];
              const totalQuestions = answers.length;
              const reviewedQuestions = answers.filter(
                (a) => a.marks !== undefined
              ).length;
              const pctReviewed =
                totalQuestions > 0
                  ? Math.round((reviewedQuestions / totalQuestions) * 100)
                  : 0;
              const isResume = targetAttempt.status === "review_in_progress";

              return (
                <div className="rounded-xl border border-slate-200/70 bg-slate-50/50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-brand-600 dark:text-brand-400">
                      {isResume ? "Review in Progress" : "Next in Queue"}
                    </span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 shadow-2xs dark:bg-slate-700 dark:text-slate-300">
                      Attempt #{targetAttempt.attemptNumber}
                    </span>
                  </div>

                  <p className="mt-2 truncate text-sm font-bold text-slate-900 dark:text-white">
                    {examName}
                  </p>

                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 font-medium">
                    {agentName}
                  </p>

                  {/* Progress bar */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>Progress</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {reviewedQuestions} / {totalQuestions} questions reviewed
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-brand-600 transition-all duration-300"
                        style={{ width: `${Math.max(5, pctReviewed)}%` }}
                      />
                    </div>
                  </div>

                  {/* CTA Button */}
                  <div className="mt-4">
                    <Link
                      href={`/auditor/exams/${targetAttempt.examId}/review`}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-xs font-bold text-white shadow-xs transition hover:bg-brand-700 active:scale-[0.98]"
                    >
                      <span>{isResume ? "Continue Review" : "Start Review"}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })()
          )}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
        Syncs automatically with your grading progress
      </div>
    </div>
  );
}
