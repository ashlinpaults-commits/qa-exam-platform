"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getExam } from "@/lib/exams";
import { startAttempt, saveAnswer, submitAttempt, getAttempt } from "@/lib/attempts";
import { useAuth } from "@/context/AuthContext";
import type { Exam, Question, ExamAttempt } from "@/types";
import { AnswerInput } from "@/components/questions/AnswerInput";
import { Loader2, ChevronLeft, ChevronRight, Check } from "lucide-react";

// Debounce autosave so we don't write to Firestore on every keystroke.
function useDebouncedSave(fn: () => void, delay: number, deps: unknown[]) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(fn, delay);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function TakeExam({ examId }: { examId: string }) {
  const { profile } = useAuth();
  const router = useRouter();
  const [exam, setExam] = useState<Exam | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempt, setAttempt] = useState<ExamAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!profile) return;
    (async () => {
      try {
        const e = await getExam(examId);
        if (!e) throw new Error("This exam is no longer available.");
        setExam(e);

        const attemptId = await startAttempt(e, profile.uid);
        const a = await getAttempt(attemptId);
        setAttempt(a);

        if (a) {
        // Each answer carries a snapshot of the question exactly as it
        // was when this attempt started — use that instead of a live
        // Question Bank fetch, so an auditor editing a question mid-exam
        // can't change what the agent is currently looking at. Older
        // attempts created before snapshots existed fall back to a live
        // fetch so they keep working.
        const qs = a.answers
          .map((ans) => ans.questionSnapshot ?? e.questionSnapshots?.[ans.questionId])
          .filter(Boolean) as Question[];
        if (qs.length !== a.answers.length) {
          throw new Error("This exam is missing its safe question content. Ask an auditor to republish it.");
        }
        setQuestions(qs);

        const initial: Record<string, string> = {};
        a.answers.forEach((ans) => (initial[ans.questionId] = ans.agentAnswer));
          setAnswers(initial);
        }
      } catch (err) {
        console.error("Failed to load attempt", err);
        setError(err instanceof Error ? err.message : "Couldn't load this exam. Please retry.");
      } finally {
        setLoading(false);
      }
    })();
  }, [examId, profile]);

  const current = questions[index];

  useDebouncedSave(
    () => {
      if (!attempt || !current) return;
      const val = answers[current.id];
      if (val === undefined) return;
      setSaveStatus("saving");
      saveAnswer(attempt.id, current.id, val, attempt.answers).then((updated) => {
        setAttempt((prev) => (prev ? { ...prev, answers: updated } : prev));
        setSaveStatus("saved");
      }).catch((err) => {
        console.error("Failed to save answer", err);
        setSaveStatus("idle");
        setError(err instanceof Error ? err.message : "Couldn't save your answer. Check your connection and retry.");
      });
    },
    900,
    [answers[current?.id ?? ""]]
  );

  async function handleSubmit() {
    if (!attempt) return;
    setSubmitting(true);
    try {
      // The debounce may still be pending for the last field the agent typed.
      // Flush it before changing the attempt status to submitted.
      if (current && answers[current.id] !== undefined) {
        await saveAnswer(attempt.id, current.id, answers[current.id], attempt.answers);
      }
      await submitAttempt(attempt.id, attempt.startedAt);
      router.push("/agent/dashboard");
    } catch (err) {
      console.error("Failed to submit attempt", err);
      setError(err instanceof Error ? err.message : "Couldn't submit your exam. Please retry.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !exam || !current) {
    if (error) {
      return <div className="mx-auto max-w-2xl rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>;
    }
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  const progress = ((index + 1) / questions.length) * 100;

  return (
    <div className="mx-auto max-w-2xl">
      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-sm text-slate-500">
          <span>Question {index + 1} of {questions.length}</span>
          <span className="capitalize">
            {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved" : ""}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
          <div className="h-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="card p-6">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-brand-600">
          {current.module} · {current.feature}
        </p>
        <h2 className="mb-4 text-lg font-medium">{current.questionText}</h2>
        <AnswerInput
          question={current}
          value={answers[current.id] ?? ""}
          onChange={(v) => setAnswers((prev) => ({ ...prev, [current.id]: v }))}
        />
      </div>

      <div className="mt-4 flex justify-between">
        <button className="btn-secondary" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Previous
        </button>
        {index < questions.length - 1 ? (
          <button className="btn-primary" onClick={() => setIndex((i) => i + 1)}>
            Next <ChevronRight className="ml-1 h-4 w-4" />
          </button>
        ) : (
          <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
            Submit exam
          </button>
        )}
      </div>
    </div>
  );
}
