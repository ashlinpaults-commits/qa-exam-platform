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
import { getQuestion } from "./questions";

import type {
  ExamAttempt,
  AttemptAnswer,
  RecordingMetadata,
  Exam,
  KnowledgeGapCategory,
  Question,
} from "@/types";

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
   *
   * Each answer carries a full snapshot of the question as it exists
   * right now. Question Bank entries can be edited or deleted later —
   * this snapshot is what keeps this attempt showing exactly what the
   * agent was actually asked, forever, regardless of future edits.
   */

  const orderedQuestionRefs = [
    ...exam.questions,
  ].sort(
    (a, b) =>
      a.order - b.order
  );

  // Agents cannot read the question bank (it contains answer keys). The
  // auditor publishes a redacted snapshot on the exam instead.
  const answers: AttemptAnswer[] = orderedQuestionRefs.map((question) => ({
    questionId: question.questionId,
    agentAnswer: "",
    maxMarks: 10,
    ...(exam.questionSnapshots?.[question.questionId]
      ? { questionSnapshot: exam.questionSnapshots[question.questionId] }
      : {}),
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
          agentAnswers: {},
          startedAt: Date.now(),
          status: "in_progress",
          analyticsFinalized: false,
        }
      );
    }
  );

  /*
   * Automatically transition exam from published -> active on first attempt.
   */
  if (exam.status === "published") {
    try {
      await updateDoc(doc(db, "exams", exam.id), {
        status: "active",
        updatedAt: Date.now(),
      });
      exam.status = "active";
    } catch (err) {
      console.error("Failed to auto-transition exam to active:", err);
    }
  }

  return attemptId;
}

/* =========================================================
   SAVE AGENT ANSWER
   ========================================================= */

export async function saveAnswer(
  attemptId: string,
  questionId: string,
  agentAnswer: string,
  allAnswers: AttemptAnswer[],
  recordingUrl?: string,
  recordingMeta?: RecordingMetadata
) {
  const attemptRef = doc(db, COL, attemptId);
  let updated: AttemptAnswer[] = allAnswers;

  // Merge against the latest server value with atomic transaction
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(attemptRef);
    if (!snap.exists()) throw new Error("Attempt not found.");
    const current = snap.data() as ExamAttempt;
    if (current.status !== "in_progress") throw new Error("This attempt is no longer editable.");

    const agentAnswers = {
      ...(current.agentAnswers ?? {}),
      [questionId]: agentAnswer,
    };

    updated = (current.answers ?? allAnswers).map((answer) => {
      if (answer.questionId === questionId) {
        const next: AttemptAnswer = {
          ...answer,
          agentAnswer,
        };

        if (recordingUrl !== undefined) {
          next.recordingUrl = recordingUrl;
        }
        if (recordingMeta !== undefined) {
          next.recordingMeta = recordingMeta;
        } else if (agentAnswer.startsWith("{") && agentAnswer.includes("recordingUrl")) {
          try {
            const parsed = JSON.parse(agentAnswer);
            if (parsed.recordingUrl) {
              next.recordingUrl = parsed.recordingUrl;
              next.recordingMeta = {
                source: parsed.source || "external_link",
                fileSize: parsed.fileSize,
                duration: parsed.duration,
                uploadedAt: parsed.uploadedAt || Date.now(),
                fileName: parsed.fileName,
                mimeType: parsed.mimeType,
              };
            }
          } catch {
            // Ignore JSON parse errors
          }
        }
        return next;
      }
      return answer;
    });

    transaction.update(attemptRef, {
      agentAnswers,
      answers: updated,
    });
  });
  return updated;
}

/* =========================================================
   AUTO-SCORE OBJECTIVE QUESTIONS
   ========================================================= */

/**
 * Auto-scores objective question types (mcq, true_false, drag_drop_order).
 * Returns the updated answer with marks populated and a scoreHistory entry.
 * If the question is subjective (descriptive, case_study, image_based), returns answer unchanged.
 */
export function autoScoreAnswer(
  answer: AttemptAnswer,
  question: Question
): AttemptAnswer {
  // Only auto-score mcq, true_false, and drag_drop_order
  if (
    question.type !== "mcq" &&
    question.type !== "true_false" &&
    question.type !== "drag_drop_order"
  ) {
    return answer;
  }

  const agentAnswer = (answer.agentAnswer || "").trim();
  let isCorrect = false;

  if (question.type === "mcq") {
    if (question.correctOptionIndex !== undefined && question.correctOptionIndex !== null) {
      const chosenIndex = Number(agentAnswer);
      if (!isNaN(chosenIndex) && chosenIndex === question.correctOptionIndex) {
        isCorrect = true;
      } else if (
        question.options &&
        question.options[question.correctOptionIndex] !== undefined &&
        agentAnswer.toLowerCase() === question.options[question.correctOptionIndex].trim().toLowerCase()
      ) {
        isCorrect = true;
      }
    } else if (question.expectedAnswer) {
      isCorrect = agentAnswer.toLowerCase() === question.expectedAnswer.trim().toLowerCase();
    }
  } else if (question.type === "true_false") {
    const norm = agentAnswer.toLowerCase();
    if (question.correctOptionIndex !== undefined && question.correctOptionIndex !== null && question.options) {
      const correctText = (question.options[question.correctOptionIndex] || "").trim().toLowerCase();
      const chosenIndex = Number(agentAnswer);
      if (!isNaN(chosenIndex) && chosenIndex === question.correctOptionIndex) {
        isCorrect = true;
      } else if (norm === correctText) {
        isCorrect = true;
      }
    } else if (question.expectedAnswer) {
      const exp = question.expectedAnswer.trim().toLowerCase();
      isCorrect =
        norm === exp ||
        (norm === "true" && (exp === "true" || exp === "t" || exp === "1")) ||
        (norm === "false" && (exp === "false" || exp === "f" || exp === "0"));
    }
  } else if (question.type === "drag_drop_order") {
    if (question.orderItems && question.orderItems.length > 0) {
      let agentItems: string[] = [];
      try {
        const parsed = JSON.parse(agentAnswer);
        if (Array.isArray(parsed)) {
          agentItems = parsed.map((item) => String(item).trim());
        }
      } catch {
        agentItems = agentAnswer.split("\n").map((s) => s.trim()).filter(Boolean);
        if (agentItems.length === 1 && agentItems[0].includes(",")) {
          agentItems = agentItems[0].split(",").map((s) => s.trim());
        }
      }

      if (
        agentItems.length === question.orderItems.length &&
        agentItems.every(
          (item, idx) =>
            item.toLowerCase() === (question.orderItems![idx] || "").trim().toLowerCase()
        )
      ) {
        isCorrect = true;
      }
    }
  }

  const marks = isCorrect ? answer.maxMarks : 0;
  const historyEntry = {
    marks,
    changedBy: "system",
    reason: "auto-scored",
    timestamp: Date.now(),
  };

  return {
    ...answer,
    marks,
    scoreHistory: [...(answer.scoreHistory || []), historyEntry],
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

      // Auto-score objective answers at submission time
      const scoredAnswers = await Promise.all(
        attempt.answers.map(async (ans) => {
          try {
            const q = await getQuestion(ans.questionId);
            if (!q) return ans;
            return autoScoreAnswer(ans, q);
          } catch (err) {
            console.error(`Auto-score failed for question ${ans.questionId}:`, err);
            return ans;
          }
        })
      );

      transaction.update(
        attemptRef,
        {
          answers: scoredAnswers,
          status: "submitted",
          submittedAt: now,
          timeTakenSeconds,
        }
      );
    }
  );

  // Check if all assigned agents have now completed
  const currentAttempt = await getAttempt(attemptId);
  if (currentAttempt) {
    checkAndTransitionExamCompletion(currentAttempt.examId).catch(console.error);
  }
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

  // Check if all assigned agents have completed their exam
  checkAndTransitionExamCompletion(attempt.examId).catch(console.error);

  return finalized;
}

/* =========================================================
   ATTEMPT ARCHIVE / UNARCHIVE
   ========================================================= */

/**
 * Non-destructively archive an attempt.
 *
 * The attempt document remains stored in Firestore with all answers,
 * scores, remarks, and audit history intact. It is excluded from
 * applicable active analytics calculations.
 */
export async function archiveAttempt(attemptId: string): Promise<void> {
  await updateDoc(doc(db, COL, attemptId), {
    archived: true,
    archivedAt: Date.now(),
  });
}

/**
 * Restore an archived attempt back to active status.
 */
export async function unarchiveAttempt(attemptId: string): Promise<void> {
  await updateDoc(doc(db, COL, attemptId), {
    archived: false,
    archivedAt: Date.now(),
  });
}

/**
 * Automatically transitions an exam to "completed" if all assigned agents
 * have finished their required attempts.
 */
export async function checkAndTransitionExamCompletion(examId: string): Promise<void> {
  try {
    const examDoc = await getDoc(doc(db, "exams", examId));
    if (!examDoc.exists()) return;
    const examData = examDoc.data() as Exam;

    if (
      examData.status === "completed" ||
      examData.status === "draft" ||
      examData.status === "archived" ||
      !examData.assignedAgentIds ||
      examData.assignedAgentIds.length === 0
    ) {
      return;
    }

    const allAttempts = await fetchAttemptsForExam(examId);
    const activeAttempts = allAttempts.filter((a) => !a.archived);

    const allFinished = examData.assignedAgentIds.every((agentId) => {
      const agentAttempts = activeAttempts.filter((a) => a.agentId === agentId);
      if (agentAttempts.length === 0) return false;

      if (examData.mode === "until_perfect") {
        return agentAttempts.some(
          (a) => a.status === "reviewed" && a.maxTotalMarks && a.totalMarks === a.maxTotalMarks
        );
      }

      // Normal mode: finished if submitted, review in progress, or reviewed
      return agentAttempts.some(
        (a) => a.status === "submitted" || a.status === "review_in_progress" || a.status === "reviewed"
      );
    });

    if (allFinished) {
      await updateDoc(doc(db, "exams", examId), {
        status: "completed",
        updatedAt: Date.now(),
      });
    }
  } catch (err) {
    console.error("Failed to check exam completion transition:", err);
  }
}

/**
 * Reassigns wrong or imperfectly scored questions (< maxMarks) from a reviewed attempt
 * to create a targeted retake attempt for the agent.
 */
export async function reassignWrongAnswers(
  parentAttempt: ExamAttempt,
  exam: Exam,
  reassignedBy?: string
): Promise<string> {
  const wrongAnswers = parentAttempt.answers.filter(
    (a) => (a.marks ?? 0) < a.maxMarks
  );

  if (wrongAnswers.length === 0) {
    throw new Error("No imperfect answers found to reassign in this attempt.");
  }

  const retakeQuestionIds = wrongAnswers.map((a) => a.questionId);

  // Fetch prior attempts for attempt numbering
  const prior = await fetchAttemptsForAgent(parentAttempt.agentId, exam.id);
  const attemptNumber =
    prior.length > 0
      ? Math.max(...prior.map((a) => a.attemptNumber)) + 1
      : 1;

  const answers: AttemptAnswer[] = wrongAnswers.map((a) => ({
    questionId: a.questionId,
    agentAnswer: "",
    maxMarks: a.maxMarks,
  }));

  const attemptId = `${exam.id}_${parentAttempt.agentId}_${attemptNumber}`;
  const attemptRef = doc(db, COL, attemptId);

  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(attemptRef);
    if (existing.exists()) return;

    transaction.set(attemptRef, {
      examId: exam.id,
      agentId: parentAttempt.agentId,
      attemptNumber,
      answers,
      startedAt: Date.now(),
      status: "in_progress",
      analyticsFinalized: false,
      isRetake: true,
      retakeOfAttemptId: parentAttempt.id,
      retakeQuestionIds,
    });
  });

  return attemptId;
}