import {
  collection, doc, addDoc, updateDoc, getDocs, getDoc, query, where, orderBy,
} from "firebase/firestore";
import { db } from "./firebase";
import { updateQuestion, getQuestion } from "./questions";
import type { ExamAttempt, AttemptAnswer, Exam } from "@/types";

const COL = "attempts";

export async function fetchAttemptsForExam(examId: string): Promise<ExamAttempt[]> {
  const q = query(collection(db, COL), where("examId", "==", examId), orderBy("startedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamAttempt));
}

export async function fetchAttemptsForAgent(agentId: string, examId?: string): Promise<ExamAttempt[]> {
  const clauses = examId
    ? [where("agentId", "==", agentId), where("examId", "==", examId)]
    : [where("agentId", "==", agentId)];
  const q = query(collection(db, COL), ...clauses, orderBy("startedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ExamAttempt));
}

export async function getAttempt(id: string): Promise<ExamAttempt | null> {
  const snap = await getDoc(doc(db, COL, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as ExamAttempt) : null;
}

// Starts a new attempt. Attempt number = count of prior attempts + 1 (permanent history, never overwritten).
export async function startAttempt(exam: Exam, agentId: string): Promise<string> {
  const prior = await fetchAttemptsForAgent(agentId, exam.id);
  const attemptNumber = prior.length + 1;

  const answers: AttemptAnswer[] = exam.questions
    .sort((a, b) => a.order - b.order)
    .map((q) => ({ questionId: q.questionId, agentAnswer: "", maxMarks: 10 }));

  const ref = await addDoc(collection(db, COL), {
    examId: exam.id,
    agentId,
    attemptNumber,
    answers,
    startedAt: Date.now(),
    status: "in_progress" as const,
  });
  return ref.id;
}

// Autosave: patch a single answer without touching the rest.
export async function saveAnswer(attemptId: string, questionId: string, agentAnswer: string, allAnswers: AttemptAnswer[]) {
  const updated = allAnswers.map((a) => (a.questionId === questionId ? { ...a, agentAnswer } : a));
  await updateDoc(doc(db, COL, attemptId), { answers: updated });
  return updated;
}

export async function submitAttempt(attemptId: string, startedAt: number) {
  const timeTakenSeconds = Math.round((Date.now() - startedAt) / 1000);
  await updateDoc(doc(db, COL, attemptId), {
    status: "submitted" as const,
    submittedAt: Date.now(),
    timeTakenSeconds,
  });
}

// Auditor scores one question. Records a score-change entry if this overwrites a prior score
// (per spec: "Auditor changed score / Reason / Timestamp").
export async function scoreAnswer(
  attempt: ExamAttempt,
  questionId: string,
  marks: number,
  comments: string,
  scoredBy: string,
  changeReason?: string
) {
  const answers = attempt.answers.map((a) => {
    if (a.questionId !== questionId) return a;
    const isChange = a.marks !== undefined && a.marks !== marks;
    const history = a.scoreHistory ?? [];
    return {
      ...a,
      marks,
      comments,
      scoreHistory: isChange
        ? [...history, { marks, changedBy: scoredBy, reason: changeReason || "Re-scored", timestamp: Date.now() }]
        : history,
    };
  });

  const allScored = answers.every((a) => a.marks !== undefined);
  const totalMarks = answers.reduce((sum, a) => sum + (a.marks ?? 0), 0);
  const maxTotalMarks = answers.reduce((sum, a) => sum + a.maxMarks, 0);

  await updateDoc(doc(db, COL, attempt.id), {
    answers,
    totalMarks,
    maxTotalMarks,
    status: allScored ? "reviewed" : "submitted",
    reviewedBy: scoredBy,
    reviewedAt: Date.now(),
  });

  // Update denormalized question stats for the Question Analytics screen.
  if (allScored) {
    const q = await getQuestion(questionId);
    if (q) {
      const timesAsked = q.stats.timesAsked + 1;
      const correct = marks >= q.stats.avgMarks * 0.7 || marks >= 7; // heuristic: >=70% counts "correct"
      const correctCount = Math.round((q.stats.correctPct / 100) * q.stats.timesAsked) + (correct ? 1 : 0);
      await updateQuestion(questionId, {
        stats: {
          timesAsked,
          avgMarks: (q.stats.avgMarks * q.stats.timesAsked + marks) / timesAsked,
          correctPct: (correctCount / timesAsked) * 100,
          incorrectPct: 100 - (correctCount / timesAsked) * 100,
        },
      });
    }
  }

  return answers;
}
