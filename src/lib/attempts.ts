import {
  collection,
  doc,
  updateDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  runTransaction,
} from "firebase/firestore";

import { db } from "./firebase";

import type {
  ExamAttempt,
  AttemptAnswer,
  Exam,
  KnowledgeGapCategory,
  Question,
} from "@/types";
import { stripUndefined } from "./questions";

const COL = "attempts";

function normalizeAgentAnswers(attempt: ExamAttempt): ExamAttempt {
  const agentAnswers = attempt.agentAnswers ?? {};
  return {
    ...attempt,
    answers: attempt.answers.map((answer) =>
      Object.prototype.hasOwnProperty.call(agentAnswers, answer.questionId)
        ? { ...answer, agentAnswer: agentAnswers[answer.questionId] }
        : answer
    ),
  };
}

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

  return snap.docs.map((d) =>
    normalizeAgentAnswers({ id: d.id, ...d.data() } as ExamAttempt)
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

  return snap.docs.map((d) =>
    normalizeAgentAnswers({ id: d.id, ...d.data() } as ExamAttempt)
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
    ? normalizeAgentAnswers({ id: snap.id, ...snap.data() } as ExamAttempt)
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
  console.debug(`[startAttempt] examId=${exam.id} agentId=${agentId}`);
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
    console.debug(`[startAttempt] Resuming active attemptId=${existingActive.id} attemptNumber=${existingActive.attemptNumber}`);
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
   * REATTEMPT PERMISSION CHECK
   * -------------------------------------------------------
   */
  const permission = exam.reattemptPermissions?.[agentId];
  const sortedPrior = [...prior].sort(
    (a, b) => (b.attemptNumber || 0) - (a.attemptNumber || 0) || (b.startedAt || 0) - (a.startedAt || 0)
  );
  const latestAttempt = sortedPrior[0];
  const latestReviewed = sortedPrior.find((attempt) => attempt.status === "reviewed");

  const hasActiveReattemptPermission = Boolean(
    permission &&
    (!latestAttempt || permission.grantedAt > latestAttempt.startedAt)
  );

  /*
   * -------------------------------------------------------
   * NORMAL EXAM
   * -------------------------------------------------------
   *
   * Normal exams cannot be repeated after review unless an auditor
   * explicitly granted reattempt authorization.
   */

  if (
    exam.mode === "normal" &&
    prior.some(
      (attempt) =>
        attempt.status === "reviewed"
    )
  ) {
    if (!hasActiveReattemptPermission) {
      throw new Error(
        "This exam has already been completed."
      );
    }
  }

  /*
   * -------------------------------------------------------
   * PERFECT 10 EXAM
   * -------------------------------------------------------
   */

  if (exam.mode === "until_perfect") {
    /*
     * If the latest reviewed attempt is perfect,
     * the exam is finished unless auditor explicitly reassigned.
     */
    if (
      latestReviewed &&
      latestReviewed.maxTotalMarks &&
      latestReviewed.totalMarks ===
        latestReviewed.maxTotalMarks &&
      !hasActiveReattemptPermission
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
   *
   * Each answer carries a full snapshot of the question as it exists
   * right now. Question Bank entries can be edited or deleted later —
   * this snapshot is what keeps this attempt showing exactly what the
   * agent was actually asked, forever, regardless of future edits.
   */

  let targetQuestionRefs = [
    ...exam.questions,
  ].sort(
    (a, b) =>
      a.order - b.order
  );

  // If this is an authorized reattempt with specific question scoping:
  if (
    attemptNumber > 1 &&
    hasActiveReattemptPermission &&
    permission?.questionIds &&
    permission.questionIds.length > 0
  ) {
    const allowedQIdSet = new Set(permission.questionIds);
    const filtered = targetQuestionRefs.filter((q) => allowedQIdSet.has(q.questionId));
    if (filtered.length > 0) {
      targetQuestionRefs = filtered;
    }
  }

  // Agents cannot read the question bank (it contains answer keys). The
  // auditor publishes a redacted snapshot on the exam instead.
  // Reattempts carry forward frozen snapshots from exam or prior attempt.
  const answers: AttemptAnswer[] = targetQuestionRefs.map((question) => {
    const questionSnapshot =
      exam.questionSnapshots?.[question.questionId] ||
      latestReviewed?.answers.find((a) => a.questionId === question.questionId)?.questionSnapshot;

    return {
      questionId: question.questionId,
      agentAnswer: "",
      maxMarks: 10,
      ...(questionSnapshot ? { questionSnapshot } : {}),
    };
  });

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

  console.debug(`[startAttempt] Attempting atomic creation attemptId=${attemptId} attemptNumber=${attemptNumber}`);

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
        console.debug(`[startAttempt] Found concurrently created attemptId=${attemptId}`);
        return;
      }

      const payload: Record<string, unknown> = {
        examId: exam.id,
        agentId,
        attemptNumber,
        answers,
        agentAnswers: {},
        startedAt: Date.now(),
        status: "in_progress",
        analyticsFinalized: false,
      };

      if (attemptNumber > 1) {
        payload.isReattempt = true;
        if (latestReviewed) {
          payload.parentAttemptId = latestReviewed.id;
        }
        if (permission?.mode) {
          payload.reattemptSource =
            permission.mode === "wrong_answers"
              ? "wrong_answers"
              : permission.mode === "select_questions"
              ? "manual_selection"
              : "same_questions";
        }
      }

      transaction.set(
        attemptRef,
        payload
      );
      console.debug(`[startAttempt] Created attempt payload written for attemptId=${attemptId}`);
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
  const attemptRef = doc(db, COL, attemptId);
  let updated: AttemptAnswer[] = allAnswers;

  // Merge against the latest server value. Writing the caller's whole,
  // potentially stale map could lose an answer saved by another tab.
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(attemptRef);
    if (!snap.exists()) throw new Error("Attempt not found.");
    const current = snap.data() as ExamAttempt;
    if (current.status !== "in_progress") throw new Error("This attempt is no longer editable.");

    // Avoid unnecessary document writes if the answer hasn't changed
    if (current.agentAnswers?.[questionId] === agentAnswer) {
      updated = (current.answers ?? allAnswers);
      return;
    }

    const agentAnswers = {
      ...(current.agentAnswers ?? {}),
      [questionId]: agentAnswer,
    };
    updated = (current.answers ?? allAnswers).map((answer) =>
      answer.questionId === questionId ? { ...answer, agentAnswer } : answer
    );
    transaction.update(attemptRef, { agentAnswers });
    console.debug(`[saveAnswer] Saved answer for attemptId=${attemptId} questionId=${questionId}`);
  });
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
  console.debug(`[submitAttempt] Submitting attemptId=${attemptId}`);
  const attemptRef = doc(
    db,
    COL,
    attemptId
  );

  /*
   * A double-click, a network retry, or a refresh mid-submit can fire this
   * twice. The old version did getAttempt() (read) then updateDoc() (write)
   * with no atomicity between them, so two near-simultaneous calls could
   * both pass the "already submitted?" check before either write landed.
   * That never created a second attempt (the attempt doc already exists —
   * this function only flips its status), but it could double-write and
   * race on timeTakenSeconds. A transaction makes the check-then-write
   * atomic and still idempotent on repeat calls.
   */
  await runTransaction(
    db,
    async (transaction) => {
      const snap =
        await transaction.get(
          attemptRef
        );

      if (!snap.exists()) {
        throw new Error(
          "Attempt not found."
        );
      }

      const attempt =
        snap.data() as ExamAttempt;

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

      transaction.update(
        attemptRef,
        {
          status: "submitted",
          submittedAt: now,
          timeTakenSeconds,
        }
      );
    }
  );
}

/* =========================================================
   SAVE REVIEW DRAFT
   ========================================================= */

/**
 * Save auditor scoring WITHOUT finalizing the review.
 *
 * This is the Save Draft operation.
 *
 * IMPORTANT — two-auditor concurrency:
 * The old version mapped over the ANSWERS ARRAY PASSED IN BY THE CALLER
 * (a snapshot of whatever the auditor's browser had loaded) and wrote that
 * entire array back. If Auditor A opened the attempt, then Auditor B also
 * opened it, then A scored Q4 and saved, B's browser still only knew about
 * the pre-A state — so when B scored Q7 and saved, B's write silently
 * reverted Q4 back to A's pre-save value. Classic stale-object overwrite.
 *
 * This now runs inside a Firestore transaction that reads the CURRENT
 * document at commit time and only ever touches the ONE answer being
 * scored — every other answer (including one another auditor just saved)
 * passes through untouched. A finalized ("reviewed") attempt is also
 * rejected here at the data layer, not just via a disabled button, since
 * scores are meant to be locked once a review is finalized.
 */
export async function saveReviewDraft(
  attempt: ExamAttempt,
  questionId: string,
  marks: number,
  comments: string,
  scoredBy: string,
  knowledgeGapCategory?: KnowledgeGapCategory,
  changeReason?: string
): Promise<ExamAttempt> {
  if (marks < 0) {
    throw new Error(
      "Marks cannot be below zero."
    );
  }

  const attemptRef = doc(
    db,
    COL,
    attempt.id
  );

  return runTransaction(
    db,
    async (transaction) => {
      const snap =
        await transaction.get(
          attemptRef
        );

      if (!snap.exists()) {
        throw new Error(
          "Attempt not found."
        );
      }

      const fresh = normalizeAgentAnswers({
        id: snap.id,
        ...snap.data(),
      } as ExamAttempt);

      /*
       * Data-layer lock: once a review is finalized, this path can no
       * longer silently reopen and rewrite it.
       */
      if (
        fresh.status === "reviewed"
      ) {
        throw new Error(
          "This review has already been finalized and can no longer be edited here."
        );
      }

      const target =
        fresh.answers.find(
          (answer) =>
            answer.questionId ===
            questionId
        );

      if (!target) {
        throw new Error(
          "Question answer not found."
        );
      }

      if (
        marks >
        target.maxMarks
      ) {
        throw new Error(
          `Marks cannot exceed ${target.maxMarks}.`
        );
      }

      const answers =
        fresh.answers.map(
          (answer) => {
            if (
              answer.questionId !==
              questionId
            ) {
              return answer;
            }

            const isChange =
              answer.marks !==
                undefined &&
              answer.marks !== marks;

            const history =
              answer.scoreHistory ?? [];

            const updatedAnswer:
              AttemptAnswer = {
              ...answer,

              marks,

              comments:
                comments ?? "",

              scoreHistory:
                isChange
                  ? [
                      ...history,
                      {
                        marks,
                        changedBy:
                          scoredBy,
                        reason:
                          changeReason?.trim() ||
                          "Score updated during review",
                        timestamp:
                          Date.now(),
                      },
                    ]
                  : history,
            };

            /*
             * Firestore cannot store undefined.
             *
             * Only store a knowledge gap when
             * the answer actually lost marks.
             */
            if (
              marks <
                answer.maxMarks &&
              knowledgeGapCategory
            ) {
              updatedAnswer.knowledgeGapCategory =
                knowledgeGapCategory;
            } else {
              delete updatedAnswer.knowledgeGapCategory;
            }

            return updatedAnswer;
          }
        );

      const updateData = {
        answers,
        status:
          "review_in_progress" as const,
        reviewedBy: scoredBy,
        reviewStartedAt:
          fresh.reviewStartedAt ??
          Date.now(),
      };

      transaction.update(
        attemptRef,
        updateData
      );

      return { ...fresh, ...updateData };
    }
  );
}

/* =========================================================
   FINALIZE REVIEW
   ========================================================= */

/**
 * Finalize the ENTIRE review.
 *
 * This is the ONLY operation that changes an attempt
 * to "reviewed".
 *
 * IMPORTANT — atomicity:
 * The old version read the attempt once (getAttempt), computed totals from
 * that read, then wrote the totals/status separately — with no atomicity
 * between the "is this already reviewed?" check and the write. Two
 * near-simultaneous calls (an accidental double-click, or a finalize that
 * lands just as one last saveReviewDraft commits) could both pass the
 * check and both write, one of them scoring from stale answers. The
 * status check, total computation, and write now happen inside a single
 * transaction against the CURRENT document, so finalize is atomic and the
 * totals always reflect the latest saved scores.
 */
export async function finalizeReview(
  attemptId: string,
  reviewerId: string
): Promise<ExamAttempt> {
  const attemptRef = doc(
    db,
    COL,
    attemptId
  );

  const finalizedCore =
    await runTransaction(
      db,
      async (transaction) => {
        const snap =
          await transaction.get(
            attemptRef
          );

        if (!snap.exists()) {
          throw new Error(
            "Attempt not found."
          );
        }

        const attempt = normalizeAgentAnswers({
          id: snap.id,
          ...snap.data(),
        } as ExamAttempt);

        /*
         * Prevent accidental duplicate finalization.
         */
        if (
          attempt.status ===
          "reviewed"
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
         * Calculate totals from the CURRENT answers, not a
         * potentially-stale earlier read.
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

        const updateData = {
          totalMarks,
          maxTotalMarks,
          status:
            "reviewed" as const,
          reviewedBy: reviewerId,
          reviewedAt,
        };

        transaction.update(
          attemptRef,
          updateData
        );

        return {
          ...attempt,
          ...updateData,
        };
      }
    );

  const attempt = finalizedCore;

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
    /*
     * Multiple agents share the same question bank, so two attempts that
     * reference the same question can be finalized around the same time
     * (e.g. an auditor clearing a review queue). The previous version did
     * getQuestion() (read) then batch.update() (write) with the new stats
     * computed from that read — a classic read-modify-write race: if two
     * finalizations overlap, the second write silently clobbers the
     * first's contribution to timesAsked/avgMarks/correctPct.
     *
     * Each question's stat update now runs in its own Firestore
     * transaction, which reads the CURRENT doc at commit time and
     * automatically retries if another transaction wrote to it first —
     * so concurrent finalizations for the same question no longer lose
     * data.
     */
    for (
      const answer
      of attempt.answers
    ) {
      const questionRef = doc(
        db,
        "questions",
        answer.questionId
      );

      await runTransaction(
        db,
        async (transaction) => {
          const snap =
            await transaction.get(
              questionRef
            );

          if (!snap.exists()) {
            return;
          }

          const question =
            snap.data() as {
              stats?: {
                timesAsked?: number;
                avgMarks?: number;
                correctPct?: number;
              };
            };

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

          transaction.update(
            questionRef,
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
      );
    }

    /*
     * Mark analytics as processed.
     */
    await updateDoc(
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

/* =========================================================
   AMEND SCORECARD
   ========================================================= */

export interface QuestionAmendmentInput {
  questionId: string;
  marks: number;
  comments?: string;
  knowledgeGapCategory?: KnowledgeGapCategory;
}

/**
 * Dedicated Amend Scorecard workflow for finalized reviews.
 *
 * Requirements:
 * - Uses a transaction reading fresh server state.
 * - Requires an explicit amendment reason.
 * - Modifies only explicitly amended grading fields.
 * - Recalculates totalMarks and maxTotalMarks.
 * - Appends to each amended question's scoreHistory with auditor ID, reason, and timestamp.
 * - Preserves attempt identity (id, examId, agentId, attemptNumber, startedAt).
 * - Preserves snapshots, agentAnswers, and original review timing.
 * - Protects question analytics from being double-counted.
 */
export async function amendScorecard(
  attemptId: string,
  amendments: QuestionAmendmentInput[],
  amendedBy: string,
  reason: string
): Promise<ExamAttempt> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new Error("An explicit reason is required to amend a finalized scorecard.");
  }

  const attemptRef = doc(db, COL, attemptId);

  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(attemptRef);
    if (!snap.exists()) {
      throw new Error("Attempt not found.");
    }

    const current = normalizeAgentAnswers({
      id: snap.id,
      ...snap.data(),
    } as ExamAttempt);

    if (current.status !== "reviewed" && current.status !== "submitted" && current.status !== "review_in_progress") {
      throw new Error("Only submitted or finalized attempts can be amended.");
    }

    const amendmentMap = new Map(amendments.map((a) => [a.questionId, a]));
    const now = Date.now();

    // Map answers and apply amendments
    const updatedAnswers: AttemptAnswer[] = current.answers.map((answer) => {
      const amendment = amendmentMap.get(answer.questionId);
      if (!amendment) {
        return stripUndefined(answer);
      }

      const { marks, comments, knowledgeGapCategory } = amendment;
      if (marks < 0) {
        throw new Error("Marks cannot be below zero.");
      }
      if (marks > answer.maxMarks) {
        throw new Error(`Marks for question cannot exceed ${answer.maxMarks}.`);
      }

      const isChanged = answer.marks !== marks || (comments !== undefined && comments !== (answer.comments || ""));
      const history = answer.scoreHistory ?? [];

      const updatedAnswer: Record<string, any> = {
        ...answer,
        marks,
        comments: comments !== undefined ? comments : (answer.comments || ""),
        scoreHistory: isChanged
          ? [
              ...history,
              {
                marks,
                changedBy: amendedBy || "auditor",
                reason: trimmedReason,
                timestamp: now,
              },
            ]
          : history,
      };

      if (marks < answer.maxMarks && knowledgeGapCategory) {
        updatedAnswer.knowledgeGapCategory = knowledgeGapCategory;
      } else {
        delete updatedAnswer.knowledgeGapCategory;
      }

      const clean = stripUndefined(updatedAnswer);
      if (clean.questionSnapshot) {
        clean.questionSnapshot = stripUndefined(clean.questionSnapshot);
      }
      return clean as AttemptAnswer;
    });

    // Recalculate totals
    const totalMarks = updatedAnswers.reduce((sum, a) => sum + (a.marks ?? 0), 0);
    const maxTotalMarks = updatedAnswers.reduce((sum, a) => sum + a.maxMarks, 0);

    // Only update keys permitted by firestore.rules for auditor update
    const updatePayload = stripUndefined({
      answers: updatedAnswers,
      totalMarks,
      maxTotalMarks,
    });

    console.debug("[amendScorecard] Committing amendment:", { attemptId, totalMarks, maxTotalMarks, amendedBy });
    transaction.update(attemptRef, updatePayload);

    return {
      ...current,
      ...updatePayload,
    };
  });
}

/* =========================================================
   MERGE SCORECARDS (ORIGINAL + REATTEMPTS)
   ========================================================= */

export interface MergedAnswerRecord {
  questionId: string;
  questionSnapshot?: Question;
  agentAnswer: string;
  marks?: number;
  maxMarks: number;
  comments?: string;
  sourceAttemptNumber: number;
}

export interface MergedScorecard {
  examId: string;
  agentId: string;
  totalMarks: number;
  maxTotalMarks: number;
  percentage: number;
  attemptsCount: number;
  latestAttemptNumber: number;
  mergedAnswers: MergedAnswerRecord[];
}

/**
 * Computes a unified scorecard for an agent across all historical attempts for an exam.
 * Reattempt answers override earlier scores for the reattempted questions, while questions
 * passed in earlier attempts are preserved at their historical marks.
 */
export function computeMergedScorecard(
  exam: Exam,
  attempts: ExamAttempt[]
): MergedScorecard | null {
  const reviewedAttempts = attempts
    .filter((a) => a.status === "reviewed")
    .sort((a, b) => a.attemptNumber - b.attemptNumber);

  if (reviewedAttempts.length === 0) {
    return null;
  }

  const answerMap = new Map<string, MergedAnswerRecord>();

  // Iterate chronologically so later attempts update the question's final grade
  for (const attempt of reviewedAttempts) {
    for (const ans of attempt.answers) {
      if (ans.marks !== undefined) {
        answerMap.set(ans.questionId, {
          questionId: ans.questionId,
          questionSnapshot: ans.questionSnapshot || exam.questionSnapshots?.[ans.questionId],
          agentAnswer: ans.agentAnswer,
          marks: ans.marks,
          maxMarks: ans.maxMarks,
          comments: ans.comments,
          sourceAttemptNumber: attempt.attemptNumber,
        });
      }
    }
  }

  const mergedAnswers = Array.from(answerMap.values());
  const totalMarks = mergedAnswers.reduce((sum, a) => sum + (a.marks ?? 0), 0);
  const maxTotalMarks = mergedAnswers.reduce((sum, a) => sum + a.maxMarks, 0);
  const percentage = maxTotalMarks > 0 ? Math.round((totalMarks / maxTotalMarks) * 100) : 0;

  return {
    examId: exam.id,
    agentId: reviewedAttempts[0].agentId,
    totalMarks,
    maxTotalMarks,
    percentage,
    attemptsCount: reviewedAttempts.length,
    latestAttemptNumber: reviewedAttempts[reviewedAttempts.length - 1].attemptNumber,
    mergedAnswers,
  };
}