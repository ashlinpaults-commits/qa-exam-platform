import { doc, getDoc, setDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "./firebase";
import {
  evaluateDeterministicAnswer,
  type QuestionEvaluationInput,
} from "./aiEvaluation";
import type {
  ExamAttempt,
  Exam,
  Question,
  AttemptAiReview,
  AiReviewProgress,
  AiQuestionEvaluation,
} from "@/types";

const COL = "ai_reviews";

/**
 * Loads the existing AI review record for an attempt from Firestore.
 */
export async function fetchAiReview(
  attemptId: string
): Promise<AttemptAiReview | null> {
  try {
    const snap = await getDoc(doc(db, COL, attemptId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as AttemptAiReview;
  } catch (error) {
    console.warn(`Could not fetch AI review for attempt ${attemptId}:`, error);
    return null;
  }
}

/**
 * Saves or updates an AI review record in Firestore.
 */
export async function saveAiReview(review: AttemptAiReview): Promise<void> {
  const ref = doc(db, COL, review.attemptId);
  await setDoc(ref, review, { merge: true });
}

/**
 * Records that an auditor has manually edited or approved a specific question's mark,
 * preserving it from ever being overwritten by subsequent AI review runs.
 */
export async function recordAuditorOverride(
  attemptId: string,
  questionId: string
): Promise<void> {
  try {
    const ref = doc(db, COL, attemptId);
    await updateDoc(ref, {
      auditorOverrides: arrayUnion(questionId),
    });
  } catch {
    // If doc doesn't exist yet, it's fine; will be preserved locally in component state
  }
}

/**
 * Runs the full AI Review on all answers of an attempt:
 * 1. Evaluates deterministic questions (MCQ, True/False, Drag & Drop, and blank answers)
 * 2. Batches semantic / qualitative questions and calls the secure server-side API
 * 3. Assembles the complete AttemptAiReview record
 * 4. Saves to Firestore
 * 5. Returns the structured review
 */
export async function runAiReviewAllForAttempt({
  attempt,
  exam,
  questions,
  auditorId,
  auditorName,
  idToken,
  onProgress,
}: {
  attempt: ExamAttempt;
  exam: Exam;
  questions: Record<string, Question>;
  auditorId: string;
  auditorName: string;
  idToken?: string;
  onProgress?: (progress: AiReviewProgress) => void;
}): Promise<AttemptAiReview> {
  const total = attempt.answers.length;
  onProgress?.({
    current: 0,
    total,
    stage: "starting",
    message: "Initializing AI review...",
  });

  const evaluations: Record<string, AiQuestionEvaluation> = {};
  const semanticItems: QuestionEvaluationInput[] = [];

  // Step 1: Separate deterministic vs semantic questions
  attempt.answers.forEach((answer) => {
    const question = questions[answer.questionId];
    if (!question) return;

    const deterministic = evaluateDeterministicAnswer(
      question,
      answer.agentAnswer,
      answer.maxMarks || 10
    );

    if (deterministic) {
      evaluations[question.id] = deterministic;
    } else {
      semanticItems.push({
        questionId: question.id,
        questionText: question.questionText,
        expectedAnswer: question.expectedAnswer,
        notes: question.notes,
        module: question.module,
        feature: question.feature,
        type: question.type,
        agentAnswer: answer.agentAnswer,
        maxMarks: answer.maxMarks || 10,
        caseStudyContext: question.caseStudyContext,
        imageUrl: question.imageUrl,
        options: question.options,
        correctOptionIndex: question.correctOptionIndex,
        orderItems: question.orderItems,
      });
    }
  });

  // Report initial deterministic progress
  const deterministicCount = Object.keys(evaluations).length;
  onProgress?.({
    current: deterministicCount,
    total,
    stage: "evaluating",
    message: `Evaluated ${deterministicCount} deterministic answer(s)...`,
  });

  // Step 2: Call the server API for semantic questions
  if (semanticItems.length > 0) {
    onProgress?.({
      current: deterministicCount,
      total,
      stage: "evaluating",
      message: `Analyzing ${semanticItems.length} answer(s) with AI...`,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (idToken) {
      headers["Authorization"] = `Bearer ${idToken}`;
    }

    const res = await fetch("/api/ai-review", {
      method: "POST",
      headers,
      body: JSON.stringify({
        attemptId: attempt.id,
        examId: exam.id,
        items: semanticItems,
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(
        errData.error || `AI evaluation service returned status ${res.status}.`
      );
    }

    const data = await res.json();
    if (data.evaluations) {
      Object.assign(evaluations, data.evaluations);
    }
  }

  // Step 3: Compute totals
  let totalSuggestedMarks = 0;
  let maxTotalMarks = 0;

  attempt.answers.forEach((ans) => {
    const evaluation = evaluations[ans.questionId];
    if (evaluation) {
      totalSuggestedMarks += evaluation.suggestedMarks;
      maxTotalMarks += evaluation.maxMarks;
    } else {
      maxTotalMarks += ans.maxMarks || 10;
    }
  });

  onProgress?.({
    current: total,
    total,
    stage: "saving",
    message: "Saving AI suggestions...",
  });

  // Step 4: Fetch existing overrides if this attempt was previously reviewed
  const existingReview = await fetchAiReview(attempt.id);
  const auditorOverrides = existingReview?.auditorOverrides ?? [];

  const aiReviewRecord: AttemptAiReview = {
    id: attempt.id,
    attemptId: attempt.id,
    examId: exam.id,
    agentId: attempt.agentId,
    initiatedBy: auditorId,
    initiatedByName: auditorName,
    createdAt: existingReview?.createdAt ?? Date.now(),
    completedAt: Date.now(),
    status: "completed",
    evaluations,
    totalSuggestedMarks,
    maxTotalMarks,
    totalQuestions: total,
    answersReviewedCount: Object.keys(evaluations).length,
    auditorOverrides,
  };

  // Step 5: Save record to Firestore
  await saveAiReview(aiReviewRecord);

  onProgress?.({
    current: total,
    total,
    stage: "completed",
    message: "AI Review Complete",
  });

  return aiReviewRecord;
}
