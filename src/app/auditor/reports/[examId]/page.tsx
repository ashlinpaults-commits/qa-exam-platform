"use client";

import { useEffect, useMemo, useState } from "react";

import { getExam } from "@/lib/exams";
import { fetchAttemptsForExam } from "@/lib/attempts";
import { fetchAllUsers } from "@/lib/users";

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

  const reviewedAttempts =
    useMemo(
      () =>
        attempts.filter(
          (a) => a.status === "reviewed"
        ),
      [attempts]
    );

  const averageScore =
    useMemo(() => {
      if (!reviewedAttempts.length)
        return 0;

      const total =
        reviewedAttempts.reduce(
          (sum, attempt) =>
            sum +
            ((attempt.totalMarks ?? 0) /
              (attempt.maxTotalMarks ||
                1)) *
              100,
          0
        );

      return Math.round(
        total /
          reviewedAttempts.length
      );
    }, [reviewedAttempts]);

  const highestScore =
    useMemo(() => {
      if (!reviewedAttempts.length)
        return 0;

      return Math.max(
        ...reviewedAttempts.map((a) =>
          Math.round(
            ((a.totalMarks ?? 0) /
              (a.maxTotalMarks ||
                1)) *
              100
          )
        )
      );
    }, [reviewedAttempts]);

  const completed =
    reviewedAttempts.length;

  const pending =
    attempts.filter(
      (a) =>
        a.status === "submitted" ||
        a.status ===
          "review_in_progress"
    ).length;

  const agentRows = users
    .filter((user) =>
      exam?.assignedAgentIds.includes(
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

      return {
        user,
        latestAttempt,
        attempts:
          agentAttempts.length,
      };
    });

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
    <div className="min-h-screen bg-slate-100 p-8">
      <div className="mx-auto max-w-7xl rounded-2xl bg-white p-8 shadow">

        <h1 className="text-4xl font-bold">
          Training Assessment Report
        </h1>

        <p className="mt-2 text-slate-500">
          {exam.name}
        </p>

        <p className="text-sm text-slate-400">
          Generated{" "}
          {new Date().toLocaleDateString()}
        </p>

        <hr className="my-8" />

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

        <div className="mt-10">
          <AgentPerformanceTable
            rows={agentRows}
          />
        </div>

      </div>
    </div>
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