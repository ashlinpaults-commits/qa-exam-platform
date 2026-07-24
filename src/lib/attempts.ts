import {
  collection,
  doc,
  addDoc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  writeBatch,
} from "firebase/firestore";

import { db } from "./firebase";
import { getQuestion } from "./questions";

import type {
  ExamAttempt,
  AttemptAnswer,
  Exam,
  KnowledgeGapCategory,
} from "@/types";

const COL = "attempts";

export async function fetchAttemptsForExam(
  examId: string
): Promise<ExamAttempt[]> {
  const q = query(
    collection(db, COL),
    where("examId", "==", examId),
    orderBy("startedAt", "desc")
  );

  const snap = await getDocs(q);

  return snap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as ExamAttempt)
  );
}

export async function fetchAttemptsForAgent(
  agentId: string,
  examId?: string
): Promise<ExamAttempt[]> {
  const clauses = examId
    ? [
        where("agentId", "==", agentId),
        where("examId", "==", examId),
      ]
    : [where("agentId", "==", agentId)];

  const q = query(
    collection(db, COL),
    ...clauses,
    orderBy("startedAt", "desc")
  );

  const snap = await getDocs(q);

  return snap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as ExamAttempt)
  );
}

export async function getAttempt(
  id: string
): Promise<ExamAttempt | null> {
  const snap = await getDoc(doc(db, COL, id));

  return snap.exists()
    ? ({ id: snap.id, ...snap.data() } as ExamAttempt)
    : null;
}

/**
 * Start a new attempt.
 *
 * Previous attempts are NEVER overwritten.
 */
export async function startAttempt(
  exam: Exam,
  agentId: string
): Promise<string> {
  const prior = await fetchAttemptsForAgent(agentId, exam.id);

  // Prevent accidentally creating multiple active attempts.
  const existingActive = prior.find(
    (a) => a.status === "in_progress"
  );

  if (existingActive) {
    return existingActive.id;
  }

  /**
   * Agents must not start another attempt while the previous
   * attempt is waiting for auditor review.
   */
  const awaitingReview = prior.find(
    (a) =>
      a.status === "submitted" ||
      a.status === "review_in_progress"
  );

  if (awaitingReview) {
    throw new Error(
      "Your previous attempt is still waiting for auditor review."
    );
  }

  /**
   * Normal exams only allow one finalized attempt.
   */
  if (
    exam.mode === "normal" &&
    prior.some((a) => a.status === "reviewed")
  ) {
    throw new Error("This exam has already been completed.");
  }

  /**
   * Perfect 10 exams only create another attempt if the
   * previous reviewed attempt was not perfect.
   */
  if (exam.mode === "until_perfect") {
    const latestReviewed = prior
      .filter((a) => a.status === "reviewed")
      .sort((a, b) => b.attemptNumber - a.attemptNumber)[0];

    if (
      latestReviewed &&
      latestReviewed.maxTotalMarks &&
      latestReviewed.totalMarks === latestReviewed.maxTotalMarks
    ) {
      throw new Error(
        "You have already achieved a perfect score on this exam."
      );
    }
  }

  const attemptNumber =
    prior.length > 0
      ? Math.max(...prior.map((a) => a.attemptNumber)) + 1
      : 1;

  const answers: AttemptAnswer[] = [...exam.questions]
    .sort((a, b) => a.order - b.order)
    .map((q) => ({
      questionId: q.questionId,
      agentAnswer: "",
      maxMarks: 10,
    }));

  const ref = await addDoc(collection(db, COL), {
    examId: exam.id,
    agentId,
    attemptNumber,
    answers,
    startedAt: Date.now(),
    status: "in_progress",
    analyticsFinalized: false,
  });

  return ref.id;
}

/**
 * Autosave an agent answer.
 */
export async function saveAnswer(
  attemptId: string,
  questionId: string,
  agentAnswer: string,
  allAnswers: AttemptAnswer[]
) {
  const updated = allAnswers.map((a) =>
    a.questionId === questionId
      ? { ...a, agentAnswer }
      : a
  );

  await updateDoc(doc(db, COL, attemptId), {
    answers: updated,
  });

  return updated;
}

/**
 * Agent submits exam.
 */
export async function submitAttempt(
  attemptId: string,
  startedAt: number
) {
  const timeTakenSeconds = Math.round(
    (Date.now() - startedAt) / 1000
  );

  await updateDoc(doc(db, COL, attemptId), {
    status: "submitted",
    submittedAt: Date.now(),
    timeTakenSeconds,
  });
}

/**
 * Save auditor scoring WITHOUT finalizing the review.
 *
 * This is effectively the Save Draft operation.
 */
export async function saveReviewDraft(
  attempt: ExamAttempt,
  questionId: string,
  marks: number,
  comments: string,
  scoredBy: string,
  knowledgeGapCategory?: KnowledgeGapCategory,
  changeReason?: string
) {
  if (marks < 0) {
    throw new Error("Marks cannot be below zero.");
  }

  const target = attempt.answers.find(
    (a) => a.questionId === questionId
  );

  if (!target) {
    throw new Error("Question answer not found.");
  }

  if (marks > target.maxMarks) {
    throw new Error(
      `Marks cannot exceed ${target.maxMarks}.`
    );
  }

  const answers = attempt.answers.map((a) => {
  if (a.questionId !== questionId) return a;

  const isChange =
    a.marks !== undefined && a.marks !== marks;

  const history = a.scoreHistory ?? [];

  const updatedAnswer: AttemptAnswer = {
    ...a,
    marks,
    comments: comments ?? "",
    scoreHistory: isChange
      ? [
          ...history,
          {
            marks,
            changedBy: scoredBy,
            reason:
              changeReason?.trim() ||
              "Score updated during review",
            timestamp: Date.now(),
          },
        ]
      : history,
  };

  // Firestore cannot store undefined.
  // Only add the field when there is an actual knowledge gap.
  if (
    marks < a.maxMarks &&
    knowledgeGapCategory
  ) {
    updatedAnswer.knowledgeGapCategory =
      knowledgeGapCategory;
  } else {
    delete updatedAnswer.knowledgeGapCategory;
  }

  return updatedAnswer;
});

  await updateDoc(doc(db, COL, attempt.id), {
    answers,
    status: "review_in_progress",
    reviewedBy: scoredBy,
    reviewStartedAt:
      attempt.reviewStartedAt ?? Date.now(),
  });

  return answers;
}

/**
 * Finalize the ENTIRE review.
 *
 * This is the only function that is allowed to turn an attempt
 * into "reviewed".
 */
export async function finalizeReview(
  attemptId: string,
  reviewerId: string
): Promise<ExamAttempt> {
  const attempt = await getAttempt(attemptId);

  if (!attempt) {
    throw new Error("Attempt not found.");
  }

  if (
    attempt.status !== "submitted" &&
    attempt.status !== "review_in_progress"
  ) {
    throw new Error(
      "This attempt is not available for review."
    );
  }

  const unscored = attempt.answers.filter(
    (a) => a.marks === undefined
  );

  if (unscored.length > 0) {
    throw new Error(
      `${unscored.length} question(s) still need marks before the review can be submitted.`
    );
  }

  const totalMarks = attempt.answers.reduce(
    (sum, a) => sum + (a.marks ?? 0),
    0
  );

  const maxTotalMarks = attempt.answers.reduce(
    (sum, a) => sum + a.maxMarks,
    0
  );

  /**
   * Finalize attempt first.
   *
   * analyticsFinalized protects question statistics from being
   * counted twice.
   */
  await updateDoc(doc(db, COL, attempt.id), {
    totalMarks,
    maxTotalMarks,
    status: "reviewed",
    reviewedBy: reviewerId,
    reviewedAt: Date.now(),
  });

  /**
   * Update question analytics once per finalized attempt.
   */
  if (!attempt.analyticsFinalized) {
    const batch = writeBatch(db);

    for (const answer of attempt.answers) {
      const question = await getQuestion(answer.questionId);

      if (!question) continue;

      const previousTimesAsked =
        question.stats?.timesAsked ?? 0;

      const previousAverage =
        question.stats?.avgMarks ?? 0;

      const previousCorrectPct =
        question.stats?.correctPct ?? 0;

      const previousCorrectCount = Math.round(
        (previousCorrectPct / 100) *
          previousTimesAsked
      );

      const marks = answer.marks ?? 0;

      /**
       * 70% or higher = correct for aggregate analytics.
       */
      const isCorrect =
        answer.maxMarks > 0 &&
        marks / answer.maxMarks >= 0.7;

      const newTimesAsked =
        previousTimesAsked + 1;

      const newCorrectCount =
        previousCorrectCount +
        (isCorrect ? 1 : 0);

      const newAverage =
        (previousAverage * previousTimesAsked +
          marks) /
        newTimesAsked;

      const correctPct =
        (newCorrectCount / newTimesAsked) * 100;

      batch.update(
        doc(db, "questions", answer.questionId),
        {
          stats: {
            timesAsked: newTimesAsked,
            avgMarks: newAverage,
            correctPct,
            incorrectPct: 100 - correctPct,
          },
          updatedAt: Date.now(),
        }
      );
    }

    batch.update(doc(db, COL, attempt.id), {
      analyticsFinalized: true,
    });

    await batch.commit();
  }

  const finalized = await getAttempt(attempt.id);

  if (!finalized) {
    throw new Error(
      "Review finalized but attempt could not be reloaded."
    );
  }

  return finalized;
}