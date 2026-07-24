import type {
  AppUser,
  ExamAttempt,
  Question,
  AttemptAnswer,
  KnowledgeGapCategory,
} from "@/types";

/* =========================================================
   COMPETENCY TYPES
   ========================================================= */

export type CompetencyStatus =
  | "highly_competent"
  | "competent"
  | "developing"
  | "needs_coaching"
  | "insufficient_data";

export type LearningTrend =
  | "improving"
  | "stable"
  | "declining"
  | "insufficient_data";

export interface ModuleCompetency {
  module: string;

  score: number;

  questionsMeasured: number;

  correctQuestions: number;

  weakQuestions: number;
}

export interface PersistentGap {
  questionId: string;

  questionText: string;

  module: string;

  feature: string;

  timesBelowThreshold: number;

  attemptsSeen: number;

  latestScorePct: number;

  knowledgeGapCategory?: KnowledgeGapCategory;
}

export interface KnowledgeGapSummary {
  category: KnowledgeGapCategory;

  count: number;
}

export interface AgentCompetency {
  agentId: string;

  agent?: AppUser;

  competencyScore: number | null;

  status: CompetencyStatus;

  reviewedAttempts: number;

  totalAttempts: number;

  questionsMeasured: number;

  latestReviewedAt?: number;

  moduleCompetency: ModuleCompetency[];

  weakestModule?: ModuleCompetency;

  strongestModule?: ModuleCompetency;

  persistentGaps: PersistentGap[];

  knowledgeGaps: KnowledgeGapSummary[];

  learningTrend: LearningTrend;

  learningVelocity: number | null;

  firstReviewedScore: number | null;

  latestReviewedScore: number | null;
}

/* =========================================================
   SETTINGS

   These values define the competency model.

   IMPORTANT:
   Keep MetricInfo descriptions aligned with these thresholds.
   ========================================================= */

export const COMPETENCY_THRESHOLDS = {
  correctAnswerPct: 70,

  highlyCompetent: 90,

  competent: 70,

  developing: 50,

  persistentGapOccurrences: 2,

  stableTrendRange: 4,
} as const;

/* =========================================================
   MAIN AGENT COMPETENCY CALCULATION
   ========================================================= */

export function calculateAgentCompetency({
  agentId,
  attempts,
  questions,
  agent,
}: {
  agentId: string;
  attempts: ExamAttempt[];
  questions: Question[];
  agent?: AppUser;
}): AgentCompetency {
  const agentAttempts = attempts
    .filter(
      (attempt) =>
        attempt.agentId === agentId
    )
    .sort(
      (a, b) =>
        getAttemptTimestamp(a) -
        getAttemptTimestamp(b)
    );

  const reviewedAttempts =
    agentAttempts.filter(
      (attempt) =>
        attempt.status === "reviewed"
    );

  const questionMap = new Map(
    questions.map((question) => [
      question.id,
      question,
    ])
  );

  /*
   * CURRENT COMPETENCY
   *
   * We intentionally use the latest reviewed answer
   * for each unique question.
   *
   * Example:
   *
   * Attempt 1:
   * Q1 = 3/10
   *
   * Attempt 2:
   * Q1 = 10/10
   *
   * Current competency for Q1 = 100%.
   *
   * The old 3/10 remains part of learning history,
   * but does not permanently drag current competency down.
   */

  const latestAnswerByQuestion =
    new Map<
      string,
      {
        answer: AttemptAnswer;
        attempt: ExamAttempt;
      }
    >();

  for (const attempt of reviewedAttempts) {
    for (const answer of attempt.answers) {
      if (answer.marks === undefined) {
        continue;
      }

      latestAnswerByQuestion.set(
        answer.questionId,
        {
          answer,
          attempt,
        }
      );
    }
  }

  let currentMarks = 0;
  let currentMaxMarks = 0;

  for (const {
    answer,
  } of latestAnswerByQuestion.values()) {
    currentMarks += answer.marks ?? 0;
    currentMaxMarks += answer.maxMarks;
  }

  const competencyScore =
    currentMaxMarks > 0
      ? round(
          (currentMarks /
            currentMaxMarks) *
            100
        )
      : null;

  /* =======================================================
     MODULE COMPETENCY
     ======================================================= */

  const moduleMap = new Map<
    string,
    {
      total: number;
      max: number;
      questionsMeasured: number;
      correctQuestions: number;
      weakQuestions: number;
    }
  >();

  for (const [
    questionId,
    record,
  ] of latestAnswerByQuestion.entries()) {
    const question =
      questionMap.get(questionId);

    if (!question) continue;

    const current =
      moduleMap.get(question.module) ?? {
        total: 0,
        max: 0,
        questionsMeasured: 0,
        correctQuestions: 0,
        weakQuestions: 0,
      };

    const percentage =
      getAnswerPercentage(
        record.answer
      );

    current.total +=
      record.answer.marks ?? 0;

    current.max +=
      record.answer.maxMarks;

    current.questionsMeasured += 1;

    if (
      percentage !== null &&
      percentage >=
        COMPETENCY_THRESHOLDS.correctAnswerPct
    ) {
      current.correctQuestions += 1;
    } else {
      current.weakQuestions += 1;
    }

    moduleMap.set(
      question.module,
      current
    );
  }

  const moduleCompetency: ModuleCompetency[] =
    Array.from(moduleMap.entries())
      .map(([module, value]) => ({
        module,

        score:
          value.max > 0
            ? round(
                (value.total /
                  value.max) *
                  100
              )
            : 0,

        questionsMeasured:
          value.questionsMeasured,

        correctQuestions:
          value.correctQuestions,

        weakQuestions:
          value.weakQuestions,
      }))
      .sort(
        (a, b) =>
          b.score - a.score
      );

  const strongestModule =
    moduleCompetency.length > 0
      ? moduleCompetency[0]
      : undefined;

  const weakestModule =
    moduleCompetency.length > 0
      ? [...moduleCompetency].sort(
          (a, b) =>
            a.score - b.score
        )[0]
      : undefined;

  /* =======================================================
     PERSISTENT KNOWLEDGE GAPS
     ======================================================= */

  const gapTracker = new Map<
    string,
    {
      belowThreshold: number;
      attemptsSeen: number;
      latestScorePct: number;
      latestCategory?: KnowledgeGapCategory;
    }
  >();

  for (const attempt of reviewedAttempts) {
    for (const answer of attempt.answers) {
      if (answer.marks === undefined) {
        continue;
      }

      const percentage =
        getAnswerPercentage(answer);

      if (percentage === null) {
        continue;
      }

      const current =
        gapTracker.get(
          answer.questionId
        ) ?? {
          belowThreshold: 0,
          attemptsSeen: 0,
          latestScorePct: percentage,
        };

      current.attemptsSeen += 1;
      current.latestScorePct =
        percentage;

      if (
        percentage <
        COMPETENCY_THRESHOLDS.correctAnswerPct
      ) {
        current.belowThreshold += 1;
      }

      if (
        answer.knowledgeGapCategory
      ) {
        current.latestCategory =
          answer.knowledgeGapCategory;
      }

      gapTracker.set(
        answer.questionId,
        current
      );
    }
  }

  const persistentGaps: PersistentGap[] =
    [];

  for (const [
    questionId,
    gap,
  ] of gapTracker.entries()) {
    if (
      gap.belowThreshold <
      COMPETENCY_THRESHOLDS.persistentGapOccurrences
    ) {
      continue;
    }

    const question =
      questionMap.get(questionId);

    if (!question) continue;

    persistentGaps.push({
      questionId,

      questionText:
        question.questionText,

      module: question.module,

      feature: question.feature,

      timesBelowThreshold:
        gap.belowThreshold,

      attemptsSeen:
        gap.attemptsSeen,

      latestScorePct:
        gap.latestScorePct,

      knowledgeGapCategory:
        gap.latestCategory,
    });
  }

  persistentGaps.sort((a, b) => {
    if (
      b.timesBelowThreshold !==
      a.timesBelowThreshold
    ) {
      return (
        b.timesBelowThreshold -
        a.timesBelowThreshold
      );
    }

    return (
      a.latestScorePct -
      b.latestScorePct
    );
  });

  /* =======================================================
     KNOWLEDGE GAP CATEGORY SUMMARY
     ======================================================= */

  const categoryMap =
    new Map<
      KnowledgeGapCategory,
      number
    >();

  for (const attempt of reviewedAttempts) {
    for (const answer of attempt.answers) {
      if (
        answer.marks === undefined ||
        !answer.knowledgeGapCategory
      ) {
        continue;
      }

      const percentage =
        getAnswerPercentage(answer);

      if (
        percentage === null ||
        percentage >=
          COMPETENCY_THRESHOLDS.correctAnswerPct
      ) {
        continue;
      }

      categoryMap.set(
        answer.knowledgeGapCategory,
        (categoryMap.get(
          answer.knowledgeGapCategory
        ) ?? 0) + 1
      );
    }
  }

  const knowledgeGaps: KnowledgeGapSummary[] =
    Array.from(
      categoryMap.entries()
    )
      .map(([category, count]) => ({
        category,
        count,
      }))
      .sort(
        (a, b) =>
          b.count - a.count
      );

  /* =======================================================
     LEARNING VELOCITY
     ======================================================= */

  const reviewedScores =
    reviewedAttempts
      .map((attempt) =>
        getAttemptScorePercentage(
          attempt
        )
      )
      .filter(
        (
          score
        ): score is number =>
          score !== null
      );

  const firstReviewedScore =
    reviewedScores.length > 0
      ? reviewedScores[0]
      : null;

  const latestReviewedScore =
    reviewedScores.length > 0
      ? reviewedScores[
          reviewedScores.length - 1
        ]
      : null;

  const learningVelocity =
    firstReviewedScore !== null &&
    latestReviewedScore !== null &&
    reviewedScores.length >= 2
      ? round(
          latestReviewedScore -
            firstReviewedScore
        )
      : null;

  const learningTrend =
    calculateLearningTrend(
      learningVelocity,
      reviewedScores.length
    );

  /* =======================================================
     FINAL RESULT
     ======================================================= */

  return {
    agentId,

    agent,

    competencyScore,

    status:
      getCompetencyStatus(
        competencyScore
      ),

    reviewedAttempts:
      reviewedAttempts.length,

    totalAttempts:
      agentAttempts.length,

    questionsMeasured:
      latestAnswerByQuestion.size,

    latestReviewedAt:
      reviewedAttempts.length > 0
        ? reviewedAttempts[
            reviewedAttempts.length -
              1
          ].reviewedAt
        : undefined,

    moduleCompetency,

    weakestModule,

    strongestModule,

    persistentGaps,

    knowledgeGaps,

    learningTrend,

    learningVelocity,

    firstReviewedScore,

    latestReviewedScore,
  };
}

/* =========================================================
   CALCULATE ALL AGENTS
   ========================================================= */

export function calculateAllAgentCompetencies({
  attempts,
  questions,
  users,
}: {
  attempts: ExamAttempt[];
  questions: Question[];
  users: AppUser[];
}): AgentCompetency[] {
  const agentIds = Array.from(
    new Set(
      attempts.map(
        (attempt) =>
          attempt.agentId
      )
    )
  );

  return agentIds
    .map((agentId) =>
      calculateAgentCompetency({
        agentId,

        attempts,

        questions,

        agent: users.find(
          (user) =>
            user.uid === agentId
        ),
      })
    )
    .sort((a, b) => {
      const scoreA =
        a.competencyScore ?? -1;

      const scoreB =
        b.competencyScore ?? -1;

      return scoreB - scoreA;
    });
}

/* =========================================================
   COMPETENCY STATUS
   ========================================================= */

export function getCompetencyStatus(
  score: number | null
): CompetencyStatus {
  if (score === null) {
    return "insufficient_data";
  }

  if (
    score >=
    COMPETENCY_THRESHOLDS.highlyCompetent
  ) {
    return "highly_competent";
  }

  if (
    score >=
    COMPETENCY_THRESHOLDS.competent
  ) {
    return "competent";
  }

  if (
    score >=
    COMPETENCY_THRESHOLDS.developing
  ) {
    return "developing";
  }

  return "needs_coaching";
}

/* =========================================================
   LEARNING TREND
   ========================================================= */

export function calculateLearningTrend(
  velocity: number | null,
  reviewedAttemptCount: number
): LearningTrend {
  if (
    velocity === null ||
    reviewedAttemptCount < 2
  ) {
    return "insufficient_data";
  }

  if (
    velocity >
    COMPETENCY_THRESHOLDS.stableTrendRange
  ) {
    return "improving";
  }

  if (
    velocity <
    -COMPETENCY_THRESHOLDS.stableTrendRange
  ) {
    return "declining";
  }

  return "stable";
}

/* =========================================================
   HELPERS
   ========================================================= */

export function getAttemptScorePercentage(
  attempt: ExamAttempt
): number | null {
  if (
    attempt.totalMarks === undefined ||
    !attempt.maxTotalMarks ||
    attempt.maxTotalMarks <= 0
  ) {
    return null;
  }

  return round(
    (attempt.totalMarks /
      attempt.maxTotalMarks) *
      100
  );
}

export function getAnswerPercentage(
  answer: AttemptAnswer
): number | null {
  if (
    answer.marks === undefined ||
    answer.maxMarks <= 0
  ) {
    return null;
  }

  return round(
    (answer.marks /
      answer.maxMarks) *
      100
  );
}

function getAttemptTimestamp(
  attempt: ExamAttempt
) {
  return (
    attempt.reviewedAt ??
    attempt.submittedAt ??
    attempt.startedAt
  );
}

function round(value: number) {
  return Math.round(
    value * 10
  ) / 10;
}