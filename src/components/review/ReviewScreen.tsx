"use client";

import { useEffect, useState } from "react";
import { fetchExams } from "@/lib/exams";
import { fetchAttemptsForExam, scoreAnswer } from "@/lib/attempts";
import { getQuestion } from "@/lib/questions";
import { fetchAllUsers } from "@/lib/users";
import { useAuth } from "@/context/AuthContext";
import type { Exam, ExamAttempt, Question, AppUser } from "@/types";
import { AnswerDisplay } from "@/components/questions/AnswerDisplay";
import { Badge, EmptyState } from "@/components/ui/Primitives";
import { ChevronDown, ChevronRight, History } from "lucide-react";

export function ReviewScreen() {
  const { profile } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [selectedExam, setSelectedExam] = useState<string>("");
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [questionCache, setQuestionCache] = useState<Record<string, Question>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetchExams().then(setExams);
    fetchAllUsers().then(setUsers);
  }, []);

  useEffect(() => {
    if (!selectedExam) return;
    fetchAttemptsForExam(selectedExam).then(async (list) => {
      setAttempts(list);
      const ids = new Set(list.flatMap((a) => a.answers.map((ans) => ans.questionId)));
      const missing = Array.from(ids).filter((id) => !questionCache[id]);
      if (missing.length) {
        const fetched = await Promise.all(missing.map((id) => getQuestion(id)));
        setQuestionCache((prev) => {
          const next = { ...prev };
          fetched.forEach((q) => q && (next[q.id] = q));
          return next;
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExam]);

  function userName(uid: string) {
    return users.find((u) => u.uid === uid)?.name ?? uid.slice(0, 8);
  }

  async function refreshAttempts() {
    if (selectedExam) setAttempts(await fetchAttemptsForExam(selectedExam));
  }

  const pendingCount = attempts.filter((a) => a.status === "submitted").length;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Review Attempts</h1>
        <select className="input w-auto" value={selectedExam} onChange={(e) => setSelectedExam(e.target.value)}>
          <option value="">Select an exam...</option>
          {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        {selectedExam && pendingCount > 0 && <Badge color="amber">{pendingCount} pending review</Badge>}
      </div>

      {!selectedExam ? (
        <EmptyState title="Pick an exam" subtitle="Choose an exam above to see agent attempts." />
      ) : attempts.length === 0 ? (
        <EmptyState title="No attempts yet" subtitle="Agents haven't attempted this exam yet." />
      ) : (
        <div className="space-y-2">
          {attempts.map((attempt) => (
            <div key={attempt.id} className="card overflow-hidden">
              <button
                className="flex w-full items-center justify-between p-4 text-left"
                onClick={() => setExpanded(expanded === attempt.id ? null : attempt.id)}
              >
                <div className="flex items-center gap-3">
                  {expanded === attempt.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <div>
                    <p className="font-medium">{userName(attempt.agentId)} — Attempt #{attempt.attemptNumber}</p>
                    <p className="text-xs text-slate-500">
                      {attempt.timeTakenSeconds ? `${Math.round(attempt.timeTakenSeconds / 60)} min · ` : ""}
                      {new Date(attempt.startedAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {attempt.status === "reviewed" && attempt.maxTotalMarks ? (
                    <Badge color={attempt.totalMarks === attempt.maxTotalMarks ? "green" : "brand"}>
                      {attempt.totalMarks}/{attempt.maxTotalMarks}
                    </Badge>
                  ) : (
                    <Badge color={attempt.status === "submitted" ? "amber" : "slate"}>{attempt.status.replace("_", " ")}</Badge>
                  )}
                </div>
              </button>

              {expanded === attempt.id && (
                <div className="space-y-4 border-t border-slate-100 p-4 dark:border-slate-700">
                  {attempt.answers.map((ans) => {
                    const q = questionCache[ans.questionId];
                    if (!q) return null;
                    return (
                      <QuestionScoreRow
                        key={ans.questionId}
                        question={q}
                        answer={ans}
                        attempt={attempt}
                        reviewerId={profile!.uid}
                        onScored={refreshAttempts}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionScoreRow({
  question,
  answer,
  attempt,
  reviewerId,
  onScored,
}: {
  question: Question;
  answer: ExamAttempt["answers"][number];
  attempt: ExamAttempt;
  reviewerId: string;
  onScored: () => void;
}) {
  const [marks, setMarks] = useState(answer.marks ?? 0);
  const [comments, setComments] = useState(answer.comments ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const isRescore = answer.marks !== undefined;

  async function handleScore() {
    setSaving(true);
    await scoreAnswer(attempt, question.id, marks, comments, reviewerId, isRescore ? reason : undefined);
    setSaving(false);
    onScored();
  }

  return (
    <div className="rounded-xl border border-slate-100 p-4 dark:border-slate-700">
      <p className="mb-2 text-sm font-medium">{question.questionText}</p>
      <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Expected Answer</p>
        <p>{question.expectedAnswer}</p>
      </div>
      <div className="mb-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Agent Answer</p>
        <AnswerDisplay question={question} agentAnswer={answer.agentAnswer} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[100px_1fr]">
        <div>
          <label className="mb-1 block text-xs font-medium">Marks (/{answer.maxMarks})</label>
          <input
            type="number"
            min={0}
            max={answer.maxMarks}
            className="input"
            value={marks}
            onChange={(e) => setMarks(Number(e.target.value))}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium">Comments</label>
          <input className="input" value={comments} onChange={(e) => setComments(e.target.value)} />
        </div>
      </div>

      {isRescore && (
        <input
          className="input mt-2"
          placeholder="Reason for changing the score (logged permanently)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      )}

      <div className="mt-3 flex items-center gap-3">
        <button className="btn-primary" onClick={handleScore} disabled={saving}>
          {saving ? "Saving..." : isRescore ? "Update score" : "Save score"}
        </button>
        {answer.scoreHistory && answer.scoreHistory.length > 0 && (
          <button className="flex items-center gap-1 text-xs text-slate-500 hover:underline" onClick={() => setShowHistory((s) => !s)}>
            <History className="h-3.5 w-3.5" /> {answer.scoreHistory.length} score change(s)
          </button>
        )}
      </div>

      {showHistory && answer.scoreHistory && (
        <div className="mt-2 space-y-1 rounded-lg bg-amber-50 p-3 text-xs dark:bg-amber-900/20">
          {answer.scoreHistory.map((h, i) => (
            <p key={i}>
              Score changed to <strong>{h.marks}</strong> by {h.changedBy} — "{h.reason}" ({new Date(h.timestamp).toLocaleString()})
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
