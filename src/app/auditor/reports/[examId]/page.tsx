"use client";

import { useEffect, useMemo, useState } from "react";

import { getExam } from "@/lib/exams";
import { fetchAttemptsForExam, computeExamMasterScorecard } from "@/lib/attempts";
import { fetchAllUsers } from "@/lib/users";
import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AuditorNav } from "@/components/layout/AuditorNav";

import AgentPerformanceTable from "@/components/reports/AgentPerformanceTable";

import type {
  Exam,
  ExamAttempt,
  AppUser,
} from "@/types";

export default function ReportPage({
  params,
}: {
  params: { examId: string };
}) {
  const [exam, setExam] =
    useState<Exam | null>(null);

  const [attempts, setAttempts] =
    useState<ExamAttempt[]>([]);

  const [users, setUsers] =
    useState<AppUser[]>([]);

  const [loading, setLoading] =
    useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [
          examData,
          attemptData,
          usersData,
        ] = await Promise.all([
          getExam(params.examId),
          fetchAttemptsForExam(
            params.examId
          ),
          fetchAllUsers(),
        ]);

        setExam(examData);
        setAttempts(attemptData);
        setUsers(usersData);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [params.examId]);

  const agentRows = useMemo(() => {
    if (!exam) return [];

    return users
      .filter((user) =>
        exam.assignedAgentIds.includes(
          user.uid
        )
      )
      .map((user) => {
        const agentAttempts =
          attempts.filter(
            (a) =>
              a.agentId === user.uid
          );

        const latestAttempt =
          agentAttempts
            .filter(
              (a) =>
                a.status === "reviewed"
            )
            .sort(
              (a, b) =>
                (b.reviewedAt ?? 0) -
                (a.reviewedAt ?? 0)
            )[0];

        const masterScorecard =
          computeExamMasterScorecard(
            exam,
            agentAttempts
          );

        return {
          user,
          latestAttempt,
          attempts:
            agentAttempts.length,
          masterScorecard,
        };
      });
  }, [exam, users, attempts]);

  const agentsWithReviewedScore = useMemo(
    () =>
      agentRows.filter(
        (row) =>
          row.masterScorecard &&
          row.masterScorecard.reviewedAttemptsCount > 0
      ),
    [agentRows]
  );

  const averageScore = useMemo(() => {
    if (!agentsWithReviewedScore.length)
      return 0;

    const total = agentsWithReviewedScore.reduce(
      (sum, row) =>
        sum +
        (row.masterScorecard?.masterPercentage ?? 0),
      0
    );

    return Math.round(
      total / agentsWithReviewedScore.length
    );
  }, [agentsWithReviewedScore]);

  const highestScore = useMemo(() => {
    if (!agentsWithReviewedScore.length)
      return 0;

    return Math.max(
      ...agentsWithReviewedScore.map(
        (row) =>
          row.masterScorecard?.masterPercentage ?? 0
      )
    );
  }, [agentsWithReviewedScore]);

  const completed = useMemo(
    () =>
      agentRows.filter(
        (row) => row.masterScorecard?.isCompleted
      ).length,
    [agentRows]
  );

  const pending = attempts.filter(
    (a) =>
      a.status === "submitted" ||
      a.status === "review_in_progress"
  ).length;

  if (loading) {
    return (
      <div className="p-10">
        Loading report...
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="p-10">
        Exam not found
      </div>
    );
  }

  return (
    <RoleGate allow={["auditor"]}>
      <AppShell>
        <AuditorNav />

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200 dark:border-slate-800 dark:bg-slate-900">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            Training Assessment Report
          </h1>

          <p className="mt-1 text-slate-500">
            {exam.name}
          </p>

          <p className="text-xs text-slate-400">
            Generated {new Date().toLocaleDateString()}
          </p>

          <hr className="my-6 border-slate-100 dark:border-slate-800" />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Average Score"
              value={`${averageScore}%`}
            />

            <StatCard
              title="Highest Score"
              value={`${highestScore}%`}
            />

            <StatCard
              title="Completed"
              value={String(completed)}
            />

            <StatCard
              title="Pending Review"
              value={String(pending)}
            />
          </div>

          <div className="mt-8">
            <AgentPerformanceTable
              rows={agentRows}
            />
          </div>
        </div>
      </AppShell>
    </RoleGate>
  );
}

function StatCard({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border bg-white p-5">
      <p className="text-sm text-slate-500">
        {title}
      </p>

      <p className="mt-2 text-3xl font-bold">
        {value}
      </p>
    </div>
  );
}