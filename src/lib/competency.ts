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
/* =========================================================
   COACHING PRIORITY ENGINE
   ========================================================= */

export type CoachingPriority =
  | "high"
  | "medium"
  | "healthy"
  | "insufficient_data";

export interface CoachingSignal {
  label: string;
  detail: string;
  severity: "high" | "medium" | "positive";
}

export interface AgentCoachingAssessment {
  agentId: string;
  agent?: AppUser;

  priority: CoachingPriority;

  /*
   * Numeric score used ONLY for sorting coaching urgency.
   * Higher = more attention required.
   *
   * This is NOT the agent's competency score.
   */
  priorityScore: number;

  competencyScore: number | null;

  weakestModule?: ModuleCompetency;

  persistentGapCount: number;

  learningTrend: LearningTrend;

  learningVelocity: number | null;

  reviewedAttempts: number;

  totalAttempts: number;

  signals: CoachingSignal[];

  primaryReason: string;
}

/* =========================================================
   COACHING SETTINGS

   Keep these centralized so the model remains auditable.
   ========================================================= */

export const COACHING_THRESHOLDS = {
  criticalCompetency: 60,

  competencyThreshold: 70,

  criticalModuleScore: 50,

  weakModuleScore: 70,

  highPersistentGaps: 3,

  mediumPersistentGaps: 1,

  significantDecline: -10,

  repeatedAttemptThreshold: 3,
} as const;

/* =========================================================
   CALCULATE COACHING PRIORITY FOR ONE AGENT
   ========================================================= */

export function calculateCoachingAssessment(
  competency: AgentCompetency
): AgentCoachingAssessment {
  const signals: CoachingSignal[] = [];

  let priorityScore = 0;

  /*
   * Do not classify an agent without reviewed competency data.
   */
  if (
    competency.competencyScore === null ||
    competency.reviewedAttempts === 0
  ) {
    return {
      agentId: competency.agentId,
      agent: competency.agent,

      priority: "insufficient_data",

      priorityScore: 0,

      competencyScore:
        competency.competencyScore,

      weakestModule:
        competency.weakestModule,

      persistentGapCount:
        competency.persistentGaps.length,

      learningTrend:
        competency.learningTrend,

      learningVelocity:
        competency.learningVelocity,

      reviewedAttempts:
        competency.reviewedAttempts,

      totalAttempts:
        competency.totalAttempts,

      signals: [
        {
          label: "Insufficient data",
          detail:
            "At least one reviewed assessment is required before coaching priority can be determined.",
          severity: "medium",
        },
      ],

      primaryReason:
        "Not enough reviewed assessment data",
    };
  }

  /* =======================================================
     1. OVERALL COMPETENCY
     ======================================================= */

  if (
    competency.competencyScore <
    COACHING_THRESHOLDS.criticalCompetency
  ) {
    priorityScore += 5;

    signals.push({
      label: "Low competency",

      detail: `Current competency is ${competency.competencyScore}%, below the ${COACHING_THRESHOLDS.criticalCompetency}% critical coaching threshold.`,

      severity: "high",
    });
  } else if (
    competency.competencyScore <
    COACHING_THRESHOLDS.competencyThreshold
  ) {
    priorityScore += 3;

    signals.push({
      label: "Developing competency",

      detail: `Current competency is ${competency.competencyScore}%, below the ${COACHING_THRESHOLDS.competencyThreshold}% competency target.`,

      severity: "medium",
    });
  } else {
    signals.push({
      label: "Competency target met",

      detail: `Current competency is ${competency.competencyScore}%.`,

      severity: "positive",
    });
  }

  /* =======================================================
     2. PERSISTENT KNOWLEDGE GAPS
     ======================================================= */

  const persistentGapCount =
    competency.persistentGaps.length;

  if (
    persistentGapCount >=
    COACHING_THRESHOLDS.highPersistentGaps
  ) {
    priorityScore += 5;

    signals.push({
      label: "Multiple persistent gaps",

      detail: `${persistentGapCount} questions have been missed below competency threshold repeatedly.`,

      severity: "high",
    });
  } else if (
    persistentGapCount >=
    COACHING_THRESHOLDS.mediumPersistentGaps
  ) {
    priorityScore += 2;

    signals.push({
      label: "Persistent knowledge gap",

      detail: `${persistentGapCount} repeated knowledge ${
        persistentGapCount === 1 ? "gap has" : "gaps have"
      } been detected.`,

      severity: "medium",
    });
  }

  /* =======================================================
     3. WEAKEST MODULE
     ======================================================= */

  const weakestModule =
    competency.weakestModule;

  if (
    weakestModule &&
    weakestModule.score <
      COACHING_THRESHOLDS.criticalModuleScore
  ) {
    priorityScore += 4;

    signals.push({
      label: `Critical weakness: ${weakestModule.module}`,

      detail: `${weakestModule.module} competency is only ${weakestModule.score}%.`,

      severity: "high",
    });
  } else if (
    weakestModule &&
    weakestModule.score <
      COACHING_THRESHOLDS.weakModuleScore
  ) {
    priorityScore += 2;

    signals.push({
      label: `Weak module: ${weakestModule.module}`,

      detail: `${weakestModule.module} competency is ${weakestModule.score}%.`,

      severity: "medium",
    });
  }

  /* =======================================================
     4. LEARNING TREND
     ======================================================= */

  if (
    competency.learningTrend ===
    "declining"
  ) {
    if (
      competency.learningVelocity !== null &&
      competency.learningVelocity <=
        COACHING_THRESHOLDS.significantDecline
    ) {
      priorityScore += 4;

      signals.push({
        label: "Significant decline",

        detail: `Reviewed performance has declined by ${Math.abs(
          competency.learningVelocity
        )} percentage points from the first reviewed attempt.`,

        severity: "high",
      });
    } else {
      priorityScore += 2;

      signals.push({
        label: "Declining performance",

        detail: `Reviewed performance has declined by ${Math.abs(
          competency.learningVelocity ?? 0
        )} percentage points.`,

        severity: "medium",
      });
    }
  } else if (
    competency.learningTrend ===
    "improving"
  ) {
    signals.push({
      label: "Improving",

      detail: `Reviewed performance has improved by ${
        competency.learningVelocity ?? 0
      } percentage points.`,

      severity: "positive",
    });
  }

  /* =======================================================
     5. REPEATED ATTEMPTS

     Supporting signal only.

     We deliberately do NOT make repeated attempts sufficient
     by themselves to create High coaching priority because
     Until Perfect exams naturally generate retries.
     ======================================================= */

  if (
    competency.totalAttempts >=
      COACHING_THRESHOLDS.repeatedAttemptThreshold &&
    competency.competencyScore <
      COACHING_THRESHOLDS.competencyThreshold
  ) {
    priorityScore += 1;

    signals.push({
      label: "Repeated attempts",

      detail: `${competency.totalAttempts} attempts have been recorded while current competency remains below target.`,

      severity: "medium",
    });
  }

  /* =======================================================
     FINAL PRIORITY

     High:
     Strong evidence that intervention is required.

     Medium:
     Coaching opportunity / developing weakness.

     Healthy:
     No material coaching warning currently detected.
     ======================================================= */

  let priority: CoachingPriority;

  if (priorityScore >= 7) {
    priority = "high";
  } else if (priorityScore >= 2) {
    priority = "medium";
  } else {
    priority = "healthy";
  }

  /*
   * Find the strongest reason to display in compact UI.
   */

  const highSignal =
    signals.find(
      (signal) =>
        signal.severity === "high"
    );

  const mediumSignal =
    signals.find(
      (signal) =>
        signal.severity === "medium"
    );

  const positiveSignal =
    signals.find(
      (signal) =>
        signal.severity === "positive"
    );

  const primaryReason =
    highSignal?.label ??
    mediumSignal?.label ??
    positiveSignal?.label ??
    "No significant coaching risks detected";

  return {
    agentId: competency.agentId,

    agent: competency.agent,

    priority,

    priorityScore,

    competencyScore:
      competency.competencyScore,

    weakestModule,

    persistentGapCount,

    learningTrend:
      competency.learningTrend,

    learningVelocity:
      competency.learningVelocity,

    reviewedAttempts:
      competency.reviewedAttempts,

    totalAttempts:
      competency.totalAttempts,

    signals,

    primaryReason,
  };
}

/* =========================================================
   CALCULATE COACHING PRIORITY FOR ALL AGENTS
   ========================================================= */

export function calculateAllCoachingAssessments(
  competencies: AgentCompetency[]
): AgentCoachingAssessment[] {
  const priorityOrder: Record<
    CoachingPriority,
    number
  > = {
    high: 0,
    medium: 1,
    healthy: 2,
    insufficient_data: 3,
  };

  return competencies
    .map(calculateCoachingAssessment)
    .sort((a, b) => {
      /*
       * Priority group first.
       */
      const priorityDifference =
        priorityOrder[a.priority] -
        priorityOrder[b.priority];

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      /*
       * Within the same group, show the strongest
       * coaching signals first.
       */
      if (
        b.priorityScore !==
        a.priorityScore
      ) {
        return (
          b.priorityScore -
          a.priorityScore
        );
      }

      /*
       * Lower competency comes first when urgency ties.
       */
      const scoreA =
        a.competencyScore ?? 101;

      const scoreB =
        b.competencyScore ?? 101;

      return scoreA - scoreB;
    });
}