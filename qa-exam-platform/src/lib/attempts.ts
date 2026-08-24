import {
  collection,
  doc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  writeBatch,
  runTransaction,
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

/* =========================================================
   FETCH ATTEMPTS FOR EXAM
   ========================================================= */

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

/* =========================================================
   FETCH ATTEMPTS FOR AGENT
   ========================================================= */

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

/* =========================================================
   GET SINGLE ATTEMPT
   ========================================================= */

export async function getAttempt(
  id: string
): Promise<ExamAttempt | null> {
  const snap = await getDoc(doc(db, COL, id));

  return snap.exists()
    ? ({ id: snap.id, ...snap.data() } as ExamAttempt)
    : null;
}

/* =========================================================
   START ATTEMPT
   ========================================================= */

/**
 * Starts or resumes an attempt.
 *
 * IMPORTANT:
 *
 * Attempts now use a deterministic Firestore document ID:
 *
 * examId_agentId_attemptNumber
 *
 * This prevents React double-calls / rapid clicks from creating
 * two different Firestore documents for the same attempt number.
 *
 * Creation is performed inside a Firestore transaction.
 */
export async function startAttempt(
  exam: Exam,
  agentId: string
): Promise<string> {
  /*
   * First load the agent's existing attempts for this exam.
   */
  const prior = await fetchAttemptsForAgent(
    agentId,
    exam.id
  );

  /*
   * -------------------------------------------------------
   * RESUME EXISTING ACTIVE ATTEMPT
   * -------------------------------------------------------
   */

  const existingActive = prior
    .filter(
      (attempt) =>
        attempt.status === "in_progress"
    )
    .sort(
      (a, b) =>
        b.attemptNumber - a.attemptNumber
    )[0];

  if (existingActive) {
    return existingActive.id;
  }

  /*
   * -------------------------------------------------------
   * BLOCK WHILE WAITING FOR REVIEW
   * -------------------------------------------------------
   */

  const awaitingReview = prior.find(
    (attempt) =>
      attempt.status === "submitted" ||
      attempt.status === "review_in_progress"
  );

  if (awaitingReview) {
    throw new Error(
      "Your previous attempt is still waiting for auditor review."
    );
  }

  /*
   * -------------------------------------------------------
   * NORMAL EXAM
   * -------------------------------------------------------
   *
   * Normal exams cannot be repeated after review.
   */

  if (
    exam.mode === "normal" &&
    prior.some(
      (attempt) =>
        attempt.status === "reviewed"
    )
  ) {
    throw new Error(
      "This exam has already been completed."
    );
  }

  /*
   * -------------------------------------------------------
   * PERFECT 10 EXAM
   * -------------------------------------------------------
   */

  if (exam.mode === "until_perfect") {
    const latestReviewed = prior
      .filter(
        (attempt) =>
          attempt.status === "reviewed"
      )
      .sort(
        (a, b) =>
          b.attemptNumber -
          a.attemptNumber
      )[0];

    /*
     * If the latest reviewed attempt is perfect,
     * the exam is finished.
     */
    if (
      latestReviewed &&
      latestReviewed.maxTotalMarks &&
      latestReviewed.totalMarks ===
        latestReviewed.maxTotalMarks
    ) {
      throw new Error(
        "You have already achieved a perfect score on this exam."
      );
    }
  }

  /*
   * -------------------------------------------------------
   * DETERMINE NEXT ATTEMPT NUMBER
   * -------------------------------------------------------
   */

  const attemptNumber =
    prior.length > 0
      ? Math.max(
          ...prior.map(
            (attempt) =>
              attempt.attemptNumber
          )
        ) + 1
      : 1;

  /*
   * -------------------------------------------------------
   * CREATE ANSWERS
   * -------------------------------------------------------
   */

  const answers: AttemptAnswer[] = [
    ...exam.questions,
  ]
    .sort(
      (a, b) =>
        a.order - b.order
    )
    .map((question) => ({
      questionId: question.questionId,
      agentAnswer: "",
      maxMarks: 10,
    }));

  /*
   * -------------------------------------------------------
   * DETERMINISTIC DOCUMENT ID
   * -------------------------------------------------------
   *
   * Same:
   *
   * exam
   * agent
   * attempt number
   *
   * = same Firestore document.
   *
   * Therefore Attempt #2 cannot be created twice.
   */

  const attemptId =
    `${exam.id}_${agentId}_${attemptNumber}`;

  const attemptRef = doc(
    db,
    COL,
    attemptId
  );

  /*
   * -------------------------------------------------------
   * ATOMIC CREATION
   * -------------------------------------------------------
   */

  await runTransaction(
    db,
    async (transaction) => {
      const existing =
        await transaction.get(
          attemptRef
        );

      /*
       * Another browser call / React call already
       * created this exact attempt.
       *
       * Do NOT create another.
       */
      if (existing.exists()) {
        return;
      }

      transaction.set(
        attemptRef,
        {
          examId: exam.id,
          agentId,
          attemptNumber,
          answers,
          startedAt: Date.now(),
          status: "in_progress",
          analyticsFinalized: false,
        }
      );
    }
  );

  return attemptId;
}

/* =========================================================
   SAVE AGENT ANSWER
   ========================================================= */

export async function saveAnswer(
  attemptId: string,
  questionId: string,
  agentAnswer: string,
  allAnswers: AttemptAnswer[]
) {
  const updated =
    allAnswers.map((answer) =>
      answer.questionId ===
      questionId
        ? {
            ...answer,
            agentAnswer,
          }
        : answer
    );

  await updateDoc(
    doc(db, COL, attemptId),
    {
      answers: updated,
    }
  );

  return updated;
}

/* =========================================================
   SUBMIT ATTEMPT
   ========================================================= */

/**
 * Agent submits an attempt.
 *
 * Submission is guarded so a submitted/reviewed attempt
 * cannot accidentally be submitted again.
 */
export async function submitAttempt(
  attemptId: string,
  startedAt: number
) {
  const attempt =
    await getAttempt(attemptId);

  if (!attempt) {
    throw new Error(
      "Attempt not found."
    );
  }

  /*
   * Already submitted.
   * Treat this as idempotent instead of creating problems.
   */
  if (
    attempt.status === "submitted" ||
    attempt.status ===
      "review_in_progress" ||
    attempt.status === "reviewed"
  ) {
    return;
  }

  if (
    attempt.status !== "in_progress"
  ) {
    throw new Error(
      "This attempt cannot be submitted."
    );
  }

  const now = Date.now();

  const timeTakenSeconds =
    Math.round(
      (now - startedAt) / 1000
    );

  await updateDoc(
    doc(db, COL, attemptId),
    {
      status: "submitted",
      submittedAt: now,
      timeTakenSeconds,
    }
  );
}

/* =========================================================
   SAVE REVIEW DRAFT
   ========================================================= */

/**
 * Save auditor scoring WITHOUT finalizing the review.
 *
 * This is the Save Draft operation for an active review.
 * If the attempt is already reviewed, the same operation performs
 * a controlled post-publication amendment and refreshes affected
 * question analytics.
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
    (answer) => answer.questionId === questionId
  );

  if (!target) {
    throw new Error("Question answer not found.");
  }

  if (marks > target.maxMarks) {
    throw new Error(`Marks cannot exceed ${target.maxMarks}.`);
  }

  const isPublishedAttempt = attempt.status === "reviewed";
  const isScoreChange =
    target.marks !== undefined && target.marks !== marks;

  /*
   * Once a scorecard has been published, a score amendment must
   * include a reason. This keeps the published result editable
   * without making changes invisible to QA leadership.
   */
  if (isPublishedAttempt && isScoreChange && !changeReason?.trim()) {
    throw new Error(
      "A reason is required when changing a score on a published scorecard."
    );
  }

  const answers = attempt.answers.map((answer) => {
    if (answer.questionId !== questionId) {
      return answer;
    }

    const history = answer.scoreHistory ?? [];

    const updatedAnswer: AttemptAnswer = {
      ...answer,
      marks,
      comments: comments ?? "",
      scoreHistory: isScoreChange
        ? [
            ...history,
            {
              previousMarks: answer.marks,
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

    /* Firestore cannot store undefined. */
    if (marks < answer.maxMarks && knowledgeGapCategory) {
      updatedAnswer.knowledgeGapCategory = knowledgeGapCategory;
    } else if (marks === answer.maxMarks) {
      delete updatedAnswer.knowledgeGapCategory;
    } else if (knowledgeGapCategory) {
      updatedAnswer.knowledgeGapCategory = knowledgeGapCategory;
    }

    return updatedAnswer;
  });

  const totalMarks = answers.reduce(
    (sum, answer) => sum + (answer.marks ?? 0),
    0
  );

  const maxTotalMarks = answers.reduce(
    (sum, answer) => sum + answer.maxMarks,
    0
  );

  const now = Date.now();

  const updateData = isPublishedAttempt
    ? {
        answers,
        totalMarks,
        maxTotalMarks,
        // Keep the original published/reviewed timestamp intact.
        status: "reviewed" as const,
        lastAmendedBy: scoredBy,
        lastAmendedAt: now,
      }
    : {
        answers,
        totalMarks,
        maxTotalMarks,
        status: "review_in_progress" as const,
        reviewedBy: scoredBy,
        reviewStartedAt: attempt.reviewStartedAt ?? now,
      };

  await updateDoc(doc(db, COL, attempt.id), updateData);

  /*
   * A post-publication score change changes the source data for
   * question-level analytics. Rebuild the affected question stats
   * from reviewed attempts so old aggregate values cannot become stale.
   * This path is intentionally correctness-first because amendments
   * are rare compared with normal dashboard reads.
   */
  if (isPublishedAttempt && isScoreChange) {
    await recalculateQuestionStats([questionId]);
  }

  return answers;
}

/* =========================================================
   REBUILD QUESTION ANALYTICS AFTER AN AMENDMENT
   ========================================================= */

async function recalculateQuestionStats(questionIds: string[]) {
  const wanted = new Set(questionIds);
  const snap = await getDocs(collection(db, COL));

  const aggregates = new Map<
    string,
    { timesAsked: number; totalMarks: number; correctCount: number }
  >();

  snap.docs.forEach((attemptDoc) => {
    const attempt = {
      id: attemptDoc.id,
      ...attemptDoc.data(),
    } as ExamAttempt;

    if (attempt.status !== "reviewed") return;

    attempt.answers.forEach((answer) => {
      if (!wanted.has(answer.questionId) || answer.marks === undefined) {
        return;
      }

      const current = aggregates.get(answer.questionId) ?? {
        timesAsked: 0,
        totalMarks: 0,
        correctCount: 0,
      };

      current.timesAsked += 1;
      current.totalMarks += answer.marks;

      if (
        answer.maxMarks > 0 &&
        answer.marks / answer.maxMarks >= 0.7
      ) {
        current.correctCount += 1;
      }

      aggregates.set(answer.questionId, current);
    });
  });

  const batch = writeBatch(db);

  for (const questionId of wanted) {
    const aggregate = aggregates.get(questionId);

    if (!aggregate || aggregate.timesAsked === 0) {
      batch.update(doc(db, "questions", questionId), {
        stats: {
          timesAsked: 0,
          avgMarks: 0,
          correctPct: 0,
          incorrectPct: 0,
        },
        updatedAt: Date.now(),
      });
      continue;
    }

    const correctPct =
      (aggregate.correctCount / aggregate.timesAsked) * 100;

    batch.update(doc(db, "questions", questionId), {
      stats: {
        timesAsked: aggregate.timesAsked,
        avgMarks: aggregate.totalMarks / aggregate.timesAsked,
        correctPct,
        incorrectPct: 100 - correctPct,
      },
      updatedAt: Date.now(),
    });
  }

  await batch.commit();
}

/* =========================================================
   FINALIZE REVIEW
   ========================================================= */

/**
 * Finalize the ENTIRE review.
 *
 * This is the operation that publishes an active review as
 * an official "reviewed" attempt. Published attempts are later
 * amendable through saveReviewDraft without reopening the review. 
 */
export async function finalizeReview(
  attemptId: string,
  reviewerId: string
): Promise<ExamAttempt> {
  const attempt =
    await getAttempt(attemptId);

  if (!attempt) {
    throw new Error(
      "Attempt not found."
    );
  }

  /*
   * Prevent accidental duplicate finalization.
   */
  if (
    attempt.status === "reviewed"
  ) {
    return attempt;
  }

  if (
    attempt.status !==
      "submitted" &&
    attempt.status !==
      "review_in_progress"
  ) {
    throw new Error(
      "This attempt is not available for review."
    );
  }

  /*
   * Every question must be scored.
   */
  const unscored =
    attempt.answers.filter(
      (answer) =>
        answer.marks ===
        undefined
    );

  if (
    unscored.length > 0
  ) {
    throw new Error(
      `${unscored.length} question(s) still need marks before the review can be submitted.`
    );
  }

  /*
   * Calculate totals.
   */
  const totalMarks =
    attempt.answers.reduce(
      (sum, answer) =>
        sum +
        (answer.marks ?? 0),
      0
    );

  const maxTotalMarks =
    attempt.answers.reduce(
      (sum, answer) =>
        sum +
        answer.maxMarks,
      0
    );

  const reviewedAt =
    Date.now();

  /*
   * -------------------------------------------------------
   * FINALIZE ATTEMPT
   * -------------------------------------------------------
   */

  await updateDoc(
    doc(db, COL, attempt.id),
    {
      totalMarks,
      maxTotalMarks,
      status: "reviewed",
      reviewedBy: reviewerId,
      reviewedAt,
    }
  );

  /*
   * -------------------------------------------------------
   * QUESTION ANALYTICS
   * -------------------------------------------------------
   *
   * Only process analytics once.
   */

  if (
    !attempt.analyticsFinalized
  ) {
    const batch =
      writeBatch(db);

    for (
      const answer
      of attempt.answers
    ) {
      const question =
        await getQuestion(
          answer.questionId
        );

      if (!question) {
        continue;
      }

      const previousTimesAsked =
        question.stats
          ?.timesAsked ?? 0;

      const previousAverage =
        question.stats
          ?.avgMarks ?? 0;

      const previousCorrectPct =
        question.stats
          ?.correctPct ?? 0;

      const previousCorrectCount =
        Math.round(
          (previousCorrectPct /
            100) *
            previousTimesAsked
        );

      const marks =
        answer.marks ?? 0;

      /*
       * 70% or higher counts as correct
       * for aggregate question analytics.
       */
      const isCorrect =
        answer.maxMarks > 0 &&
        marks /
          answer.maxMarks >=
          0.7;

      const newTimesAsked =
        previousTimesAsked + 1;

      const newCorrectCount =
        previousCorrectCount +
        (isCorrect ? 1 : 0);

      const newAverage =
        (
          previousAverage *
            previousTimesAsked +
          marks
        ) /
        newTimesAsked;

      const correctPct =
        (
          newCorrectCount /
          newTimesAsked
        ) *
        100;

      batch.update(
        doc(
          db,
          "questions",
          answer.questionId
        ),
        {
          stats: {
            timesAsked:
              newTimesAsked,

            avgMarks:
              newAverage,

            correctPct,

            incorrectPct:
              100 -
              correctPct,
          },

          updatedAt:
            Date.now(),
        }
      );
    }

    /*
     * Mark analytics as processed.
     */
    batch.update(
      doc(
        db,
        COL,
        attempt.id
      ),
      {
        analyticsFinalized:
          true,
      }
    );

    await batch.commit();
  }

  /*
   * Reload final authoritative Firestore state.
   */
  const finalized =
    await getAttempt(
      attempt.id
    );

  if (!finalized) {
    throw new Error(
      "Review finalized but attempt could not be reloaded."
    );
  }

  return finalized;
}