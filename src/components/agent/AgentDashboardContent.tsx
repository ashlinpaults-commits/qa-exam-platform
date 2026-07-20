"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { fetchAssignedExams } from "@/lib/exams";
import { fetchAttemptsForAgent } from "@/lib/attempts";
import type { Exam, ExamAttempt } from "@/types";
import { Badge, EmptyState } from "@/components/ui/Primitives";
import { TrendingUp, TrendingDown } from "lucide-react";

export function AgentDashboardContent() {
  const { profile } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    (async () => {
      const [e, a] = await Promise.all([fetchAssignedExams(profile.uid), fetchAttemptsForAgent(profile.uid)]);
      setExams(e);
      setAttempts(a);
      setLoading(false);
    })();
  }, [profile]);

  if (loading) return <p className="text-sm text-slate-400">Loading...</p>;

  const reviewed = attempts.filter((a) => a.status === "reviewed" && a.maxTotalMarks);
  const overallScorePct = reviewed.length
    ? Math.round(
        (reviewed.reduce((sum, a) => sum + (a.totalMarks! / a.maxTotalMarks!), 0) / reviewed.length) * 100
      )
    : 0;
  const perfectExams = reviewed.filter((a) => a.totalMarks === a.maxTotalMarks).length;

  // Module-level performance -> weak/strong areas. Requires the module on each
  // question, so we approximate using exam name as a stand-in module label
  // (question-level module breakdown lives in Analytics for auditors).
  const examScoreByExam: Record<string, { total: number; max: number }> = {};
  reviewed.forEach((a) => {
    const e = exams.find((ex) => ex.id === a.examId);
    if (!e) return;
    const cur = examScoreByExam[e.name] ?? { total: 0, max: 0 };
    cur.total += a.totalMarks!;
    cur.max += a.maxTotalMarks!;
    examScoreByExam[e.name] = cur;
  });
  const ranked = Object.entries(examScoreByExam)
    .map(([name, v]) => ({ name, pct: v.max ? v.total / v.max : 0 }))
    .sort((a, b) => a.pct - b.pct);
  const weak = ranked.slice(0, 2).map((r) => r.name);
  const strong = ranked.slice(-2).map((r) => r.name).reverse();

  // Improving = last 3 reviewed attempts trending up.
  const recent = [...reviewed].sort((a, b) => (a.reviewedAt ?? 0) - (b.reviewedAt ?? 0)).slice(-3);
  const improving =
    recent.length >= 2 && recent[recent.length - 1].totalMarks! / recent[recent.length - 1].maxTotalMarks! >
      recent[0].totalMarks! / recent[0].maxTotalMarks!;

  const inProgress = attempts.filter((a) => a.status === "in_progress");
  const completed = attempts.filter((a) => a.status !== "in_progress");

  // "Available to start/retry" = never attempted, OR (Until Perfect 10 mode AND
  // most recent reviewed attempt didn't hit a perfect score, AND nothing currently in progress).
  const assignedNotStarted = exams.filter((e) => {
    const examAttempts = attempts.filter((a) => a.examId === e.id);
    if (examAttempts.length === 0) return true;
    if (examAttempts.some((a) => a.status === "in_progress")) return false;
    if (e.mode !== "until_perfect") return false;
    const latest = [...examAttempts].sort((a, b) => b.attemptNumber - a.attemptNumber)[0];
    return latest.status === "reviewed" && latest.totalMarks !== latest.maxTotalMarks;
  });

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">{profile?.name}</h1>
            <p className="text-sm text-slate-500">Your performance overview</p>
          </div>
          {reviewed.length > 0 && (
            <Badge color={improving ? "green" : "slate"}>
              {improving ? <TrendingUp className="mr-1 inline h-3.5 w-3.5" /> : <TrendingDown className="mr-1 inline h-3.5 w-3.5" />}
              {improving ? "Improving" : "Steady"}
            </Badge>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Overall Score" value={`${overallScorePct}%`} />
          <Stat label="Attempts" value={String(attempts.length)} />
          <Stat label="Perfect Exams" value={String(perfectExams)} />
          <Stat label="Assigned" value={String(exams.length)} />
        </div>
        {(weak.length > 0 || strong.length > 0) && (
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Weak Areas</p>
              <ul className="text-sm">
                {weak.map((w) => <li key={w}>• {w}</li>)}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Strong Areas</p>
              <ul className="text-sm">
                {strong.map((s) => <li key={s}>• {s}</li>)}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 font-semibold">Assigned Exams</h2>
        {assignedNotStarted.length === 0 ? (
          <EmptyState title="Nothing new to take" subtitle="Check back once your auditor assigns a new exam." />
        ) : (
          <div className="space-y-2">
            {assignedNotStarted.map((e) => {
              const hasPriorAttempt = attempts.some((a) => a.examId === e.id);
              return (
                <div key={e.id} className="card flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium">{e.name}</p>
                    <p className="text-sm text-slate-500">{e.questions.length} questions · {e.mode === "until_perfect" ? "Until Perfect 10" : "Normal"}</p>
                  </div>
                  <Link href={`/agent/exams/${e.id}/take`} className="btn-primary">
                    {hasPriorAttempt ? "Retry until 10/10" : "Start"}
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {inProgress.length > 0 && (
        <div>
          <h2 className="mb-2 font-semibold">In Progress</h2>
          <div className="space-y-2">
            {inProgress.map((a) => {
              const e = exams.find((ex) => ex.id === a.examId);
              return (
                <div key={a.id} className="card flex items-center justify-between p-4">
                  <p className="font-medium">{e?.name ?? "Exam"} — Attempt #{a.attemptNumber}</p>
                  <Link href={`/agent/exams/${a.examId}/take`} className="btn-secondary">Continue</Link>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div>
          <h2 className="mb-2 font-semibold">Completed Exams</h2>
          <div className="space-y-2">
            {completed.map((a) => {
              const e = exams.find((ex) => ex.id === a.examId);
              return (
                <div key={a.id} className="card flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium">{e?.name ?? "Exam"} — Attempt #{a.attemptNumber}</p>
                    <p className="text-sm text-slate-500 capitalize">{a.status}</p>
                  </div>
                  {a.status === "reviewed" && a.maxTotalMarks ? (
                    <Badge color={a.totalMarks === a.maxTotalMarks ? "green" : "brand"}>
                      {a.totalMarks}/{a.maxTotalMarks}
                    </Badge>
                  ) : (
                    <Badge>Awaiting review</Badge>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
