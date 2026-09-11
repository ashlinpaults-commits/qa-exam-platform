"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Activity, ChevronDown, ExternalLink, Users } from "lucide-react";
import type { Exam, ExamAttempt } from "@/types";
import { fetchAttemptsForExam, computeExamMasterScorecard } from "@/lib/attempts";

interface QaPulseCardProps {
  exams: Exam[];
  initialExamId?: string;
}

export function QaPulseCard({ exams, initialExamId }: QaPulseCardProps) {
  const publishedExams = useMemo(
    () => exams.filter((e) => e.status !== "archived"),
    [exams]
  );

  const [selectedExamId, setSelectedExamId] = useState<string>(
    initialExamId || publishedExams[0]?.id || ""
  );

  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [loading, setLoading] = useState(false);

  // In-memory cache to guarantee zero redundant Firebase reads when toggling between exams
  const cacheRef = useRef<Map<string, ExamAttempt[]>>(new Map());

  useEffect(() => {
    if (!selectedExamId && publishedExams.length > 0) {
      setSelectedExamId(publishedExams[0].id);
    }
  }, [publishedExams, selectedExamId]);

  useEffect(() => {
    if (!selectedExamId) return;

    if (cacheRef.current.has(selectedExamId)) {
      setAttempts(cacheRef.current.get(selectedExamId)!);
      return;
    }

    let isMounted = true;
    setLoading(true);

    fetchAttemptsForExam(selectedExamId)
      .then((list) => {
        if (!isMounted) return;
        cacheRef.current.set(selectedExamId, list);
        setAttempts(list);
      })
      .catch((err) => {
        console.error("Failed to fetch exam attempts for QA Pulse", err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedExamId]);

  const selectedExam = useMemo(
    () => exams.find((e) => e.id === selectedExamId),
    [exams, selectedExamId]
  );

  // Demographics and Master Score calculations
  const pulseMetrics = useMemo(() => {
    if (!selectedExam) {
      return {
        totalAssigned: 0,
        completedCount: 0,
        completedPct: 0,
        inProgressCount: 0,
        inProgressPct: 0,
        pendingCount: 0,
        pendingPct: 0,
        averageScore: null,
        distribution: {
          b0_50: 0,
          b51_70: 0,
          b71_90: 0,
          b91_100: 0,
        },
        totalScored: 0,
      };
    }

    const assignedIds = new Set<string>(selectedExam.assignedAgentIds || []);
    attempts.forEach((a) => assignedIds.add(a.agentId));
    const allAgentIds = Array.from(assignedIds);

    const totalAssigned = allAgentIds.length;
    let completedCount = 0;
    let inProgressCount = 0;
    let pendingCount = 0;

    const scores: number[] = [];

    allAgentIds.forEach((agentId) => {
      const agentAttempts = attempts.filter((a) => a.agentId === agentId);
      if (agentAttempts.length === 0) return;

      const scorecard = computeExamMasterScorecard(selectedExam, agentAttempts);

      if (scorecard.isCompleted) {
        completedCount += 1;
      } else if (
        agentAttempts.some(
          (a) => a.status === "submitted" || a.status === "review_in_progress"
        )
      ) {
        pendingCount += 1;
      } else if (agentAttempts.some((a) => a.status === "in_progress")) {
        inProgressCount += 1;
      }

      if (scorecard.reviewedAttemptsCount > 0) {
        scores.push(scorecard.masterPercentage);
      }
    });

    const completedPct =
      totalAssigned > 0 ? Math.round((completedCount / totalAssigned) * 100) : 0;
    const inProgressPct =
      totalAssigned > 0 ? Math.round((inProgressCount / totalAssigned) * 100) : 0;
    const pendingPct =
      totalAssigned > 0 ? Math.round((pendingCount / totalAssigned) * 100) : 0;

    const averageScore =
      scores.length > 0
        ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length)
        : null;

    const distribution = {
      b0_50: scores.filter((s) => s <= 50).length,
      b51_70: scores.filter((s) => s > 50 && s <= 70).length,
      b71_90: scores.filter((s) => s > 70 && s <= 90).length,
      b91_100: scores.filter((s) => s > 90).length,
    };

    return {
      totalAssigned,
      completedCount,
      completedPct,
      inProgressCount,
      inProgressPct,
      pendingCount,
      pendingPct,
      averageScore,
      distribution,
      totalScored: scores.length,
    };
  }, [selectedExam, attempts]);

  const maxBucket = Math.max(
    1,
    pulseMetrics.distribution.b0_50,
    pulseMetrics.distribution.b51_70,
    pulseMetrics.distribution.b71_90,
    pulseMetrics.distribution.b91_100
  );

  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-shadow hover:shadow-card-hover dark:border-slate-800 dark:bg-slate-900">
      <div>
        {/* Header & Selector */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <Activity className="h-3.5 w-3.5" />
            </span>
            <div>
              <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
                QA Pulse
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Single-exam demographic and score distribution overview
              </p>
            </div>
          </div>

          {/* Exam Dropdown Selector */}
          <div className="relative min-w-[220px]">
            <select
              value={selectedExamId}
              onChange={(e) => setSelectedExamId(e.target.value)}
              className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50/70 py-1.5 pl-3 pr-8 text-xs font-semibold text-slate-800 transition hover:border-slate-300 focus:border-brand-500 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              {publishedExams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        {/* Demographics KPI Row */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800/80 dark:bg-slate-800/30">
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Total Assigned
            </p>
            <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
              {pulseMetrics.totalAssigned}
            </p>
          </div>

          <div className="rounded-xl border border-slate-100 bg-emerald-50/40 p-3 dark:border-slate-800/80 dark:bg-emerald-950/20">
            <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              Completed
            </p>
            <p className="mt-1 text-lg font-bold text-emerald-700 dark:text-emerald-300">
              {pulseMetrics.completedCount}{" "}
              <span className="text-xs font-normal text-emerald-600/80 dark:text-emerald-400/80">
                ({pulseMetrics.completedPct}%)
              </span>
            </p>
          </div>

          <div className="rounded-xl border border-slate-100 bg-blue-50/40 p-3 dark:border-slate-800/80 dark:bg-blue-950/20">
            <p className="text-[11px] font-medium text-blue-700 dark:text-blue-400">
              In Progress
            </p>
            <p className="mt-1 text-lg font-bold text-blue-700 dark:text-blue-300">
              {pulseMetrics.inProgressCount}{" "}
              <span className="text-xs font-normal text-blue-600/80 dark:text-blue-400/80">
                ({pulseMetrics.inProgressPct}%)
              </span>
            </p>
          </div>

          <div className="rounded-xl border border-slate-100 bg-amber-50/40 p-3 dark:border-slate-800/80 dark:bg-amber-950/20">
            <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
              Pending
            </p>
            <p className="mt-1 text-lg font-bold text-amber-700 dark:text-amber-300">
              {pulseMetrics.pendingCount}{" "}
              <span className="text-xs font-normal text-amber-600/80 dark:text-amber-400/80">
                ({pulseMetrics.pendingPct}%)
              </span>
            </p>
          </div>
        </div>

        {/* Performance & Score Distribution */}
        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/50 p-3.5 dark:border-slate-800/80 dark:bg-slate-800/40">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Average Master Score
            </span>
            <span className="text-sm font-bold text-brand-600 dark:text-brand-400">
              {pulseMetrics.averageScore !== null ? `${pulseMetrics.averageScore}%` : "No scores yet"}
            </span>
          </div>

          {/* Simple 4-Bucket Score Distribution */}
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>Score Bracket</span>
              <span>Agents</span>
            </div>

            {[
              { label: "0–50%", count: pulseMetrics.distribution.b0_50, color: "bg-rose-500" },
              { label: "51–70%", count: pulseMetrics.distribution.b51_70, color: "bg-amber-500" },
              { label: "71–90%", count: pulseMetrics.distribution.b71_90, color: "bg-blue-500" },
              { label: "91–100%", count: pulseMetrics.distribution.b91_100, color: "bg-emerald-500" },
            ].map((bucket) => {
              const widthPct =
                pulseMetrics.totalScored > 0
                  ? Math.round((bucket.count / maxBucket) * 100)
                  : 0;

              return (
                <div key={bucket.label} className="flex items-center gap-2 text-xs">
                  <span className="w-14 shrink-0 font-medium text-slate-600 dark:text-slate-400 text-[11px]">
                    {bucket.label}
                  </span>
                  <div className="relative h-2 flex-1 rounded-full bg-slate-200/70 dark:bg-slate-700 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${bucket.color}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="w-6 text-right font-bold text-slate-800 dark:text-slate-200 text-xs">
                    {bucket.count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer Link */}
      {selectedExam && (
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Link
            href={`/auditor/exams/${selectedExam.id}/results`}
            className="group inline-flex items-center gap-1 text-xs font-semibold text-brand-600 transition hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
          >
            <span>View Full Demographics & Results</span>
            <ExternalLink className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
