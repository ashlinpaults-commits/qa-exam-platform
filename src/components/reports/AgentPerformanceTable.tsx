"use client";

import type { ExamAttempt, AppUser } from "@/types";

interface AgentRow {
  user: AppUser;
  latestAttempt?: ExamAttempt;
  attempts: number;
}

interface Props {
  rows: AgentRow[];
}

export default function AgentPerformanceTable({
  rows,
}: Props) {
  return (
    <div className="mt-10 rounded-2xl border bg-white shadow-sm">
      <div className="border-b px-6 py-4">
        <h2 className="text-xl font-semibold">
          Agent Performance
        </h2>

        <p className="mt-1 text-sm text-slate-500">
          Latest reviewed competency for each trainee.
        </p>
      </div>

      <table className="w-full">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-6 py-3 text-left">Agent</th>
            <th className="px-6 py-3 text-left">Score</th>
            <th className="px-6 py-3 text-left">Attempts</th>
            <th className="px-6 py-3 text-left">Status</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const score =
              row.latestAttempt?.maxTotalMarks
                ? Math.round(
                    ((row.latestAttempt.totalMarks ?? 0) /
                      row.latestAttempt.maxTotalMarks) *
                      100
                  )
                : 0;

            return (
              <tr
                key={row.user.uid}
                className="border-t hover:bg-slate-50"
              >
                <td className="px-6 py-4">
                  <div>
                    <p className="font-medium">
                      {row.user.name}
                    </p>

                    <p className="text-sm text-slate-500">
                      {row.user.email}
                    </p>
                  </div>
                </td>

                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="h-2 w-28 rounded-full bg-slate-200">
                      <div
                        className="h-2 rounded-full bg-brand-600"
                        style={{
                          width: `${score}%`,
                        }}
                      />
                    </div>

                    <span>{score}%</span>
                  </div>
                </td>

                <td className="px-6 py-4">
                  {"✓".repeat(row.attempts)}
                </td>

                <td className="px-6 py-4">
                  {score >= 90
                    ? "🟢 Competent"
                    : score >= 70
                    ? "🟡 Needs Review"
                    : "🔴 Coaching Required"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}