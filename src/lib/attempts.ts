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
  ExamMasterScorecard,
  AttemptProgressionStep,
  QuestionMasteryRecord,
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
   FETCH PENDING REVIEW ATTEMPTS
   ========================================================= */

export async function fetchPendingReviewAttempts(): Promise<ExamAttempt[]> {
  const q = query(
    collection(db, COL),
    where("status", "in", ["submitted", "review_in_progress"])
  );

  const snap = await getDocs(q);

  const list = snap.docs.map((d) =>
    normalizeAgentAnswers({ id: d.id, ...d.data() } as ExamAttempt)
  );

  // In-memory sort by submittedAt / startedAt descending (no composite index required)
  return list.sort(
    (a, b) => (b.submittedAt || b.startedAt || 0) - (a.submittedAt || a.startedAt || 0)
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
   SAVE ALL AGENT ANSWERS (ATOMIC BATCH PERSISTENCE)
   ========================================================= */

/**
 * Atomically saves an entire map of agent answers into Firestore.
 * Merges the provided answers with any existing agentAnswers on the server.
 * Operates inside a Firestore transaction and touches ONLY `agentAnswers`
 * to strictly adhere to Firestore security rules.
 */
export async function saveAllAnswers(
  attemptId: string,
  answersMap: Record<string, string>
): Promise<void> {
  const attemptRef = doc(db, COL, attemptId);

  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(attemptRef);
    if (!snap.exists()) throw new Error("Attempt not found.");
    const current = snap.data() as ExamAttempt;
    if (current.status !== "in_progress") {
      throw new Error("This attempt is no longer editable.");
    }

    const serverAnswers = current.agentAnswers ?? {};
    let hasChanges = false;
    const merged: Record<string, string> = { ...serverAnswers };

    for (const [qid, ans] of Object.entries(answersMap)) {
      if (ans !== undefined && ans !== null && serverAnswers[qid] !== ans) {
        merged[qid] = ans;
        hasChanges = true;
      }
    }

    // Skip unnecessary write if all answers are already identical
    if (!hasChanges) {
      console.debug(`[saveAllAnswers] No answer changes to persist for attemptId=${attemptId}`);
      return;
    }

    transaction.update(attemptRef, { agentAnswers: merged });
    console.debug(
      `[saveAllAnswers] Persisted ${Object.keys(merged).length} answers for attemptId=${attemptId}`
    );
  });
}

/* =========================================================
   VERIFY PERSISTED ANSWERS
   ========================================================= */

/**
 * Reads back the attempt from Firestore and verifies that all non-empty
 * answers in `expectedAnswers` are actually present in the persisted document.
 * Returns an object indicating success and any question IDs that failed to persist.
 */
export async function verifyAttemptAnswers(
  attemptId: string,
  expectedAnswers: Record<string, string>
): Promise<{ verified: boolean; missingQuestionIds: string[] }> {
  const attemptRef = doc(db, COL, attemptId);
  const snap = await getDoc(attemptRef);

  if (!snap.exists()) {
    return { verified: false, missingQuestionIds: Object.keys(expectedAnswers) };
  }

  const data = snap.data() as ExamAttempt;
  const persisted = data.agentAnswers ?? {};
  const missing: string[] = [];

  for (const [qid, expectedVal] of Object.entries(expectedAnswers)) {
    // Only check non-empty answers
    if (expectedVal && expectedVal.trim().length > 0) {
      const persistedVal = persisted[qid];
      if (persistedVal === undefined || persistedVal === null || persistedVal !== expectedVal) {
        missing.push(qid);
      }
    }
  }

  return {
    verified: missing.length === 0,
    missingQuestionIds: missing,
  };
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
   PROGRESSIVE MASTER SCORECARD CALCULATION
   ========================================================= */

/**
 * Authoritative Master Scorecard engine for an agent and exam.
 * Reconciles progressive attempts/reassignments against the ORIGINAL exam master total.
 * Enforces non-decreasing mastery across the attempt chain.
 */
export function computeExamMasterScorecard(
  exam: Exam,
  attempts: ExamAttempt[]
): ExamMasterScorecard {
  const agentId = attempts[0]?.agentId || "";
  const examName = exam.name || "Exam";

  // 1. Establish Master Assigned Exam Questions
  const examQuestionRefs = [...(exam.questions || [])].sort((a, b) => a.order - b.order);

  // Fallback for legacy exams with empty questions list: derive from attempt answers
  const uniqueQuestionIds: string[] = [];
  if (examQuestionRefs.length > 0) {
    examQuestionRefs.forEach((ref) => {
      if (!uniqueQuestionIds.includes(ref.questionId)) {
        uniqueQuestionIds.push(ref.questionId);
      }
    });
  } else {
    attempts.forEach((a) => {
      (a.answers || []).forEach((ans) => {
        if (!uniqueQuestionIds.includes(ans.questionId)) {
          uniqueQuestionIds.push(ans.questionId);
        }
      });
    });
  }

  // Determine maxMarks per question (defaults to 10 if unspecified)
  const questionMaxMarksMap = new Map<string, number>();
  uniqueQuestionIds.forEach((qId) => {
    let max = 10;
    for (const a of attempts) {
      const match = a.answers?.find((ans) => ans.questionId === qId);
      if (match?.maxMarks && match.maxMarks > 0) {
        max = match.maxMarks;
        break;
      }
    }
    questionMaxMarksMap.set(qId, max);
  });

  // MASTER TOTAL MARKS: Fixed denominator of the original assigned exam
  const masterTotalMarks = uniqueQuestionIds.reduce(
    (sum, qId) => sum + (questionMaxMarksMap.get(qId) || 10),
    0
  );

  // 2. Sort attempts chronologically
  const sortedAttempts = [...attempts].sort(
    (a, b) => (a.attemptNumber || 0) - (b.attemptNumber || 0) || (a.startedAt || 0) - (b.startedAt || 0)
  );

  const reviewedAttempts = sortedAttempts.filter((a) => a.status === "reviewed");

  // 3. Question Mastery tracking map
  const masteryMap = new Map<string, QuestionMasteryRecord>();
  uniqueQuestionIds.forEach((qId) => {
    const snap = exam.questionSnapshots?.[qId];
    const maxMarks = questionMaxMarksMap.get(qId) || 10;
    masteryMap.set(qId, {
      questionId: qId,
      questionText: snap?.questionText || "",
      module: snap?.module || "General",
      feature: snap?.feature || "General",
      topic: snap?.topic || snap?.feature || "General",
      maxMarks,
      bestMarks: 0,
      isMastered: false,
      timesAttempted: 0,
      timesIncorrect: 0,
      progression: [],
      latestAttemptNumber: 0,
    });
  });

  // 4. Trace Progression Chronologically Across Reviewed Attempts
  const progressionSteps: AttemptProgressionStep[] = [];
  let previousMasterScore = 0;

  for (const attempt of reviewedAttempts) {
    let attemptMarks = 0;
    let attemptMaxMarks = 0;

    for (const ans of attempt.answers || []) {
      if (ans.marks === undefined) continue;

      attemptMarks += ans.marks;
      attemptMaxMarks += (ans.maxMarks || 10);

      if (!masteryMap.has(ans.questionId)) {
        masteryMap.set(ans.questionId, {
          questionId: ans.questionId,
          questionText: ans.questionSnapshot?.questionText || exam.questionSnapshots?.[ans.questionId]?.questionText || "",
          module: ans.questionSnapshot?.module || exam.questionSnapshots?.[ans.questionId]?.module || "General",
          feature: ans.questionSnapshot?.feature || exam.questionSnapshots?.[ans.questionId]?.feature || "General",
          topic: ans.questionSnapshot?.topic || ans.questionSnapshot?.feature || exam.questionSnapshots?.[ans.questionId]?.topic || "General",
          maxMarks: ans.maxMarks || 10,
          bestMarks: 0,
          isMastered: false,
          timesAttempted: 0,
          timesIncorrect: 0,
          progression: [],
          latestAttemptNumber: 0,
        });
      }

      const rec = masteryMap.get(ans.questionId)!;
      if (!rec.questionText && ans.questionSnapshot?.questionText) {
        rec.questionText = ans.questionSnapshot.questionText;
        rec.module = ans.questionSnapshot.module || rec.module;
        rec.feature = ans.questionSnapshot.feature || rec.feature;
        rec.topic = ans.questionSnapshot.topic || ans.questionSnapshot.feature || rec.topic;
      }
      rec.maxMarks = ans.maxMarks || rec.maxMarks || 10;
      rec.timesAttempted += 1;
      rec.latestAttemptNumber = attempt.attemptNumber;
      rec.latestMarks = ans.marks;
      if (ans.knowledgeGapCategory) {
        rec.knowledgeGapCategory = ans.knowledgeGapCategory;
      }

      const passThreshold = rec.maxMarks * 0.70;
      const isPassing = ans.marks >= passThreshold;
      const state: "correct" | "improvement" | "incorrect" = isPassing
        ? "correct"
        : ans.marks > 0
        ? "improvement"
        : "incorrect";

      if (state !== "correct") {
        rec.timesIncorrect += 1;
      }
      rec.progression.push(state);

      // NON-DECREASING MASTERY RULE:
      // Question retains the highest score achieved across the chain.
      // Once mastered (>= 70% or full marks), it remains mastered.
      if (ans.marks >= rec.bestMarks) {
        rec.bestMarks = ans.marks;
        rec.sourceAttemptNumber = attempt.attemptNumber;
      }
      if (rec.bestMarks >= passThreshold) {
        rec.isMastered = true;
      }
    }

    const attemptPercentage = attemptMaxMarks > 0 ? Math.round((attemptMarks / attemptMaxMarks) * 1000) / 10 : 0;

    // Cumulative Master Score at this attempt
    let cumulativeScore = 0;
    for (const rec of masteryMap.values()) {
      cumulativeScore += rec.bestMarks;
    }

    const cumulativePercentage = masterTotalMarks > 0 ? Math.round((cumulativeScore / masterTotalMarks) * 1000) / 10 : 0;
    const progressGain = Math.max(0, cumulativeScore - previousMasterScore);

    let questionsMasteredSoFar = 0;
    for (const rec of masteryMap.values()) {
      if (rec.isMastered) questionsMasteredSoFar += 1;
    }

    const totalQuestionsCount = Math.max(uniqueQuestionIds.length, masteryMap.size);
    const questionsRemaining = Math.max(0, totalQuestionsCount - questionsMasteredSoFar);

    progressionSteps.push({
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      isReattempt: Boolean(attempt.isReattempt || attempt.attemptNumber > 1),
      status: attempt.status,
      submittedAt: attempt.submittedAt,
      reviewedAt: attempt.reviewedAt,
      timeTakenSeconds: attempt.timeTakenSeconds,
      attemptMarks,
      attemptMaxMarks,
      attemptPercentage,
      attemptScore: attemptPercentage,
      rawAttemptMarks: attemptMarks,
      rawAttemptMaxMarks: attemptMaxMarks,
      rawAttemptPercentage: attemptPercentage,
      cumulativeMasterScore: cumulativeScore,
      masterTotalMarks,
      cumulativePercentage,
      progressGain,
      questionsMasteredSoFar,
      questionsRemaining,
    });

    previousMasterScore = cumulativeScore;
  }

  const currentMasterScore = previousMasterScore;
  const masterPercentage = masterTotalMarks > 0 ? Math.round((currentMasterScore / masterTotalMarks) * 1000) / 10 : 0;

  let questionsMastered = 0;
  for (const rec of masteryMap.values()) {
    if (rec.isMastered) questionsMastered += 1;
  }

  const totalQuestions = Math.max(uniqueQuestionIds.length, masteryMap.size);
  const questionsRemaining = Math.max(0, totalQuestions - questionsMastered);

  const isCompleted =
    exam.mode === "until_perfect"
      ? (currentMasterScore >= masterTotalMarks && masterTotalMarks > 0)
      : (reviewedAttempts.length > 0);

  const latestAttemptGain =
    progressionSteps.length > 0
      ? progressionSteps[progressionSteps.length - 1].progressGain
      : 0;

  const latestAttemptNumber =
    sortedAttempts.length > 0
      ? Math.max(...sortedAttempts.map((a) => a.attemptNumber || 1))
      : 1;

  return {
    examId: exam.id,
    agentId,
    examName,
    masterTotalMarks,
    currentMasterScore,
    masterPercentage,
    totalQuestions,
    questionsMastered,
    questionsRemaining,
    attemptsCount: sortedAttempts.length,
    reviewedAttemptsCount: reviewedAttempts.length,
    latestAttemptNumber,
    isCompleted,
    latestAttemptGain,
    progression: progressionSteps,
    questionMastery: Array.from(masteryMap.values()),
  };
}

/* =========================================================
   BACKWARD COMPATIBILITY: MERGE SCORECARDS WRAPPER
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
 * Backwards-compatible wrapper that now utilizes the authoritative master score engine.
 * Ensures the original master denominator is preserved and scores do not regresses.
 */
export function computeMergedScorecard(
  exam: Exam,
  attempts: ExamAttempt[]
): MergedScorecard | null {
  const reviewedAttempts = attempts.filter((a) => a.status === "reviewed");
  if (reviewedAttempts.length === 0) return null;

  const master = computeExamMasterScorecard(exam, attempts);

  const mergedAnswers: MergedAnswerRecord[] = master.questionMastery.map((q: QuestionMasteryRecord) => {
    // Find latest answer for agentAnswer and comments
    let latestAns: AttemptAnswer | undefined;
    for (const a of [...reviewedAttempts].reverse()) {
      const match = a.answers?.find((ans) => ans.questionId === q.questionId);
      if (match) {
        latestAns = match;
        break;
      }
    }

    return {
      questionId: q.questionId,
      questionSnapshot: exam.questionSnapshots?.[q.questionId] || latestAns?.questionSnapshot,
      agentAnswer: latestAns?.agentAnswer || "",
      marks: q.bestMarks,
      maxMarks: q.maxMarks,
      comments: latestAns?.comments,
      sourceAttemptNumber: q.latestAttemptNumber || 1,
    };
  });

  return {
    examId: exam.id,
    agentId: master.agentId,
    totalMarks: master.currentMasterScore,
    maxTotalMarks: master.masterTotalMarks,
    percentage: master.masterPercentage,
    attemptsCount: master.reviewedAttemptsCount,
    latestAttemptNumber: master.latestAttemptNumber,
    mergedAnswers,
  };
}