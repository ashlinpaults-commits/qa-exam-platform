"use client";

import { useEffect, useState } from "react";
import { fetchExams } from "@/lib/exams";
import { fetchAttemptsForExam } from "@/lib/attempts";
import { fetchQuestionsPage } from "@/lib/questions";
import { fetchAllUsers } from "@/lib/users";
import type { Exam, ExamAttempt, Question, AppUser } from "@/types";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { EmptyState } from "@/components/ui/Primitives";

export function AnalyticsDashboard() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const examList = await fetchExams();
      setExams(examList);
      const allAttempts = (await Promise.all(examList.map((e) => fetchAttemptsForExam(e.id)))).flat();
      setAttempts(allAttempts);
      const { docs: qs } = await fetchQuestionsPage({}, 3000);
      setQuestions(qs);
      setUsers(await fetchAllUsers());
      setLoading(false);
    })();
  }, []);

  if (loading) return <p className="text-sm text-slate-400">Loading analytics...</p>;

  const reviewed = attempts.filter((a) => a.status === "reviewed" && a.maxTotalMarks);
  if (reviewed.length === 0) {
    return <EmptyState title="No scored attempts yet" subtitle="Analytics populate once auditors start reviewing exams." />;
  }

  const scores = reviewed.map((a) => a.totalMarks! / a.maxTotalMarks!);
  const avgScore = Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 100);
  const highScore = Math.round(Math.max(...scores) * 100);
  const lowScore = Math.round(Math.min(...scores) * 100);
  const passPct = Math.round((scores.filter((s) => s >= 0.7).length / scores.length) * 100);
  const avgAttempts = (attempts.length / new Set(attempts.map((a) => a.agentId)).size || 0).toFixed(1);

  // Module performance: aggregate marks by question.module across all scored answers.
  const moduleMap: Record<string, { total: number; max: number }> = {};
  const questionById = Object.fromEntries(questions.map((q) => [q.id, q]));
  reviewed.forEach((a) => {
    a.answers.forEach((ans) => {
      const q = questionById[ans.questionId];
      if (!q || ans.marks === undefined) return;
      const cur = moduleMap[q.module] ?? { total: 0, max: 0 };
      cur.total += ans.marks;
      cur.max += ans.maxMarks;
      moduleMap[q.module] = cur;
    });
  });
  const moduleData = Object.entries(moduleMap).map(([module, v]) => ({
    module,
    score: v.max ? Math.round((v.total / v.max) * 100) : 0,
  }));

  // Frequently missed: lowest correctPct among questions that have been asked.
  const missed = questions
    .filter((q) => q.stats.timesAsked > 0)
    .sort((a, b) => a.stats.correctPct - b.stats.correctPct)
    .slice(0, 5);

  // Agent performance table.
  const agentMap: Record<string, { total: number; max: number; attempts: number }> = {};
  attempts.forEach((a) => {
    const cur = agentMap[a.agentId] ?? { total: 0, max: 0, attempts: 0 };
    cur.attempts += 1;
    if (a.status === "reviewed" && a.maxTotalMarks) {
      cur.total += a.totalMarks!;
      cur.max += a.maxTotalMarks;
    }
    agentMap[a.agentId] = cur;
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <StatCard label="Average Score" value={`${avgScore}%`} />
        <StatCard label="Avg Attempts / Agent" value={avgAttempts} />
        <StatCard label="Highest Score" value={`${highScore}%`} />
        <StatCard label="Lowest Score" value={`${lowScore}%`} />
        <StatCard label="Pass %" value={`${passPct}%`} />
      </div>

      <div className="card p-4">
        <h2 className="mb-3 font-semibold">Module Performance</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={moduleData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="module" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} unit="%" />
            <Tooltip />
            <Bar dataKey="score" fill="#4f46e5" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card p-4">
        <h2 className="mb-3 font-semibold">Frequently Missed Questions</h2>
        {missed.length === 0 ? (
          <p className="text-sm text-slate-400">Not enough scored data yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs uppercase text-slate-400">
                <th className="py-1">Question</th>
                <th className="py-1">Times Asked</th>
                <th className="py-1">Correct %</th>
              </tr>
            </thead>
            <tbody>
              {missed.map((q) => (
                <tr key={q.id} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="max-w-md truncate py-2">{q.questionText}</td>
                  <td className="py-2">{q.stats.timesAsked}</td>
                  <td className="py-2">{Math.round(q.stats.correctPct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card p-4">
        <h2 className="mb-3 font-semibold">Agent Performance</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-xs uppercase text-slate-400">
              <th className="py-1">Agent</th>
              <th className="py-1">Attempts</th>
              <th className="py-1">Avg Score</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(agentMap).map(([uid, v]) => (
              <tr key={uid} className="border-t border-slate-100 dark:border-slate-700">
                <td className="py-2">{users.find((u) => u.uid === uid)?.name ?? uid.slice(0, 8)}</td>
                <td className="py-2">{v.attempts}</td>
                <td className="py-2">{v.max ? Math.round((v.total / v.max) * 100) : "—"}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
