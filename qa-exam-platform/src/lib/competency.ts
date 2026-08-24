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
   COMPETENCY SETTINGS
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

  /* =======================================================
     CURRENT COMPETENCY

     Latest reviewed answer for each unique question.

     Old failed answers remain part of historical analytics
     but do not permanently reduce current competency.
     ======================================================= */

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

    if (!question) {
      continue;
    }

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

    if (!question) {
      continue;
    }

    persistentGaps.push({
      questionId,

      questionText:
        question.questionText,

      module:
        question.module,

      feature:
        question.feature,

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
            reviewedAttempts.length - 1
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
  reviewedScoreCount: number
): LearningTrend {
  if (
    velocity === null ||
    reviewedScoreCount < 2
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
   ATTEMPT / ANSWER HELPERS
   ========================================================= */

export function getAttemptScorePercentage(
  attempt: ExamAttempt
): number | null {
  if (
    attempt.totalMarks === undefined ||
    attempt.maxTotalMarks === undefined ||
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
  return (
    Math.round(value * 10) / 10
  );
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

  severity:
    | "high"
    | "medium"
    | "positive";
}

export interface AgentCoachingAssessment {
  agentId: string;

  agent?: AppUser;

  priority: CoachingPriority;

  /*
   * Numeric urgency score.
   *
   * This is NOT the competency score.
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

  /*
   * Phase 7 Coaching Intelligence
   */

  primaryWeakness?: string;

  recommendedCoachingArea?: string;

  topKnowledgeGap?: KnowledgeGapSummary;

  repeatedMistakeCount: number;
}

/* =========================================================
   COACHING SETTINGS
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
  const signals: CoachingSignal[] =
    [];

  let priorityScore = 0;

  /*
   * Do not classify agents without reviewed data.
   */

  if (
    competency.competencyScore === null ||
    competency.reviewedAttempts === 0
  ) {
    return {
      agentId:
        competency.agentId,

      agent:
        competency.agent,

      priority:
        "insufficient_data",

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
          label:
            "Insufficient data",

          detail:
            "At least one reviewed assessment is required before coaching priority can be determined.",

          severity:
            "medium",
        },
      ],

      primaryReason:
        "Not enough reviewed assessment data",

      primaryWeakness:
        undefined,

      recommendedCoachingArea:
        undefined,

      topKnowledgeGap:
        undefined,

      repeatedMistakeCount: 0,
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
      label:
        "Low competency",

      detail:
        `Current competency is ${competency.competencyScore}%, below the ${COACHING_THRESHOLDS.criticalCompetency}% critical coaching threshold.`,

      severity:
        "high",
    });
  } else if (
    competency.competencyScore <
    COACHING_THRESHOLDS.competencyThreshold
  ) {
    priorityScore += 3;

    signals.push({
      label:
        "Developing competency",

      detail:
        `Current competency is ${competency.competencyScore}%, below the ${COACHING_THRESHOLDS.competencyThreshold}% competency target.`,

      severity:
        "medium",
    });
  } else {
    signals.push({
      label:
        "Competency target met",

      detail:
        `Current competency is ${competency.competencyScore}%.`,

      severity:
        "positive",
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
      label:
        "Multiple persistent gaps",

      detail:
        `${persistentGapCount} questions have been missed below competency threshold repeatedly.`,

      severity:
        "high",
    });
  } else if (
    persistentGapCount >=
    COACHING_THRESHOLDS.mediumPersistentGaps
  ) {
    priorityScore += 2;

    signals.push({
      label:
        "Persistent knowledge gap",

      detail:
        `${persistentGapCount} repeated knowledge ${
          persistentGapCount === 1
            ? "gap has"
            : "gaps have"
        } been detected.`,

      severity:
        "medium",
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
      label:
        `Critical weakness: ${weakestModule.module}`,

      detail:
        `${weakestModule.module} competency is only ${weakestModule.score}%.`,

      severity:
        "high",
    });
  } else if (
    weakestModule &&
    weakestModule.score <
      COACHING_THRESHOLDS.weakModuleScore
  ) {
    priorityScore += 2;

    signals.push({
      label:
        `Weak module: ${weakestModule.module}`,

      detail:
        `${weakestModule.module} competency is ${weakestModule.score}%.`,

      severity:
        "medium",
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
        label:
          "Significant decline",

        detail:
          `Reviewed performance has declined by ${Math.abs(
            competency.learningVelocity
          )} percentage points from the first reviewed attempt.`,

        severity:
          "high",
      });
    } else {
      priorityScore += 2;

      signals.push({
        label:
          "Declining performance",

        detail:
          `Reviewed performance has declined by ${Math.abs(
            competency.learningVelocity ??
              0
          )} percentage points.`,

        severity:
          "medium",
      });
    }
  } else if (
    competency.learningTrend ===
    "improving"
  ) {
    signals.push({
      label:
        "Improving",

      detail:
        `Reviewed performance has improved by ${
          competency.learningVelocity ??
          0
        } percentage points.`,

      severity:
        "positive",
    });
  }

  /* =======================================================
     5. REPEATED ATTEMPTS
     ======================================================= */

  if (
    competency.totalAttempts >=
      COACHING_THRESHOLDS.repeatedAttemptThreshold &&
    competency.competencyScore <
      COACHING_THRESHOLDS.competencyThreshold
  ) {
    priorityScore += 1;

    signals.push({
      label:
        "Repeated attempts",

      detail:
        `${competency.totalAttempts} attempts have been recorded while current competency remains below target.`,

      severity:
        "medium",
    });
  }

  /* =======================================================
     FINAL PRIORITY
     ======================================================= */

  let priority: CoachingPriority;

  if (priorityScore >= 7) {
    priority = "high";
  } else if (
    priorityScore >= 2
  ) {
    priority = "medium";
  } else {
    priority = "healthy";
  }

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

  /* =======================================================
     PHASE 7 COACHING INTELLIGENCE
     ======================================================= */

  /*
   * Primary weakness is surfaced only when the weakest
   * measured module is below the competency target.
   */

  const primaryWeakness =
    weakestModule &&
    weakestModule.score <
      COACHING_THRESHOLDS.competencyThreshold
      ? weakestModule.module
      : undefined;

  /*
   * knowledgeGaps is already sorted highest count first.
   */

  const topKnowledgeGap =
    competency.knowledgeGaps.length > 0
      ? competency.knowledgeGaps[0]
      : undefined;

  /*
   * Count repeated below-threshold occurrences.
   *
   * Example:
   * Question A missed 3 times
   * Question B missed 2 times
   * repeatedMistakeCount = 5
   */

  const repeatedMistakeCount =
    competency.persistentGaps.reduce(
      (total, gap) =>
        total +
        gap.timesBelowThreshold,
      0
    );

  /*
   * Deterministic coaching recommendation.
   *
   * No AI-generated guesswork.
   */

  let recommendedCoachingArea:
    | string
    | undefined;

  if (
    primaryWeakness &&
    topKnowledgeGap
  ) {
    recommendedCoachingArea =
      `${primaryWeakness} - ${topKnowledgeGap.category}`;
  } else if (
    primaryWeakness
  ) {
    recommendedCoachingArea =
      primaryWeakness;
  } else if (
    topKnowledgeGap
  ) {
    recommendedCoachingArea =
      topKnowledgeGap.category;
  } else if (
    competency.persistentGaps.length >
    0
  ) {
    recommendedCoachingArea =
      "Repeated question-level knowledge gaps";
  }

  return {
    agentId:
      competency.agentId,

    agent:
      competency.agent,

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

    primaryWeakness,

    recommendedCoachingArea,

    topKnowledgeGap,

    repeatedMistakeCount,
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
    .map(
      calculateCoachingAssessment
    )
    .sort((a, b) => {
      const priorityDifference =
        priorityOrder[a.priority] -
        priorityOrder[b.priority];

      if (
        priorityDifference !== 0
      ) {
        return priorityDifference;
      }

      if (
        b.priorityScore !==
        a.priorityScore
      ) {
        return (
          b.priorityScore -
          a.priorityScore
        );
      }

      const scoreA =
        a.competencyScore ?? 101;

      const scoreB =
        b.competencyScore ?? 101;

      return scoreA - scoreB;
    });
}

/* =========================================================
   PHASE 7A
   TEAM COACHING INTELLIGENCE
   ========================================================= */

export type TeamCoachingInsightType =
  | "module_risk"
  | "knowledge_gap"
  | "improvement"
  | "decline"
  | "coaching_queue";

export type TeamCoachingInsightSeverity =
  | "high"
  | "medium"
  | "positive"
  | "info";

export interface TeamCoachingInsight {
  id: string;

  type: TeamCoachingInsightType;

  severity:
    TeamCoachingInsightSeverity;

  title: string;

  description: string;

  affectedAgents: number;

  module?: string;

  knowledgeGapCategory?:
    KnowledgeGapCategory;
}

export interface TeamModuleRisk {
  module: string;

  agentsMeasured: number;

  agentsBelowTarget: number;

  belowTargetPct: number;

  averageScore: number;
}

export interface TeamCoachingSummary {
  totalAssessedAgents: number;

  highPriorityAgents: number;

  mediumPriorityAgents: number;

  healthyAgents: number;

  improvingAgents: number;

  decliningAgents: number;

  mostCommonKnowledgeGap?:
    KnowledgeGapSummary;

  moduleRisks: TeamModuleRisk[];

  insights: TeamCoachingInsight[];
}

/* =========================================================
   CALCULATE TEAM COACHING INTELLIGENCE
   ========================================================= */

export function calculateTeamCoachingIntelligence(
  competencies: AgentCompetency[],
  assessments: AgentCoachingAssessment[]
): TeamCoachingSummary {
  /*
   * Only reviewed agents count toward team coaching
   * intelligence.
   */

  const assessedCompetencies =
    competencies.filter(
      (competency) =>
        competency.competencyScore !==
          null &&
        competency.reviewedAttempts > 0
    );

  const assessedAgentIds =
    new Set(
      assessedCompetencies.map(
        (competency) =>
          competency.agentId
      )
    );

  const assessedAssessments =
    assessments.filter(
      (assessment) =>
        assessedAgentIds.has(
          assessment.agentId
        )
    );

  /* =======================================================
     COACHING QUEUE COUNTS
     ======================================================= */

  const highPriorityAgents =
    assessedAssessments.filter(
      (assessment) =>
        assessment.priority === "high"
    ).length;

  const mediumPriorityAgents =
    assessedAssessments.filter(
      (assessment) =>
        assessment.priority === "medium"
    ).length;

  const healthyAgents =
    assessedAssessments.filter(
      (assessment) =>
        assessment.priority ===
        "healthy"
    ).length;

  /* =======================================================
     LEARNING TREND COUNTS
     ======================================================= */

  const improvingAgents =
    assessedCompetencies.filter(
      (competency) =>
        competency.learningTrend ===
        "improving"
    ).length;

  const decliningAgents =
    assessedCompetencies.filter(
      (competency) =>
        competency.learningTrend ===
        "declining"
    ).length;

  /* =======================================================
     TEAM KNOWLEDGE GAP DISTRIBUTION
     ======================================================= */

  const knowledgeGapMap =
    new Map<
      KnowledgeGapCategory,
      number
    >();

  for (
    const competency
    of assessedCompetencies
  ) {
    for (
      const gap
      of competency.knowledgeGaps
    ) {
      knowledgeGapMap.set(
        gap.category,

        (knowledgeGapMap.get(
          gap.category
        ) ?? 0) + gap.count
      );
    }
  }

  const teamKnowledgeGaps =
    Array.from(
      knowledgeGapMap.entries()
    )
      .map(
        ([category, count]) => ({
          category,
          count,
        })
      )
      .sort(
        (a, b) =>
          b.count - a.count
      );

  const mostCommonKnowledgeGap =
    teamKnowledgeGaps[0];

  /* =======================================================
     TEAM MODULE RISK
     ======================================================= */

  const moduleMap =
    new Map<
      string,
      {
        totalScore: number;
        agentsMeasured: number;
        agentsBelowTarget: number;
      }
    >();

  for (
    const competency
    of assessedCompetencies
  ) {
    for (
      const module
      of competency.moduleCompetency
    ) {
      const current =
        moduleMap.get(
          module.module
        ) ?? {
          totalScore: 0,
          agentsMeasured: 0,
          agentsBelowTarget: 0,
        };

      current.totalScore +=
        module.score;

      current.agentsMeasured +=
        1;

      if (
        module.score <
        COACHING_THRESHOLDS.competencyThreshold
      ) {
        current.agentsBelowTarget +=
          1;
      }

      moduleMap.set(
        module.module,
        current
      );
    }
  }

  const moduleRisks: TeamModuleRisk[] =
    Array.from(
      moduleMap.entries()
    )
      .map(
        ([module, value]) => ({
          module,

          agentsMeasured:
            value.agentsMeasured,

          agentsBelowTarget:
            value.agentsBelowTarget,

          belowTargetPct:
            value.agentsMeasured > 0
              ? round(
                  (value.agentsBelowTarget /
                    value.agentsMeasured) *
                    100
                )
              : 0,

          averageScore:
            value.agentsMeasured > 0
              ? round(
                  value.totalScore /
                    value.agentsMeasured
                )
              : 0,
        })
      )
      .sort((a, b) => {
        if (
          b.belowTargetPct !==
          a.belowTargetPct
        ) {
          return (
            b.belowTargetPct -
            a.belowTargetPct
          );
        }

        return (
          a.averageScore -
          b.averageScore
        );
      });

  /* =======================================================
     DATA-DRIVEN INSIGHTS
     ======================================================= */

  const insights:
    TeamCoachingInsight[] = [];

  /*
   * MODULE RETRAINING SIGNAL
   *
   * We require at least 2 affected agents.
   *
   * One weak agent is an individual coaching issue,
   * not automatically a team-training problem.
   */

  for (
    const module
    of moduleRisks
  ) {
    if (
      module.agentsBelowTarget < 2
    ) {
      continue;
    }

    const severity:
      TeamCoachingInsightSeverity =
      module.belowTargetPct >= 50
        ? "high"
        : "medium";

    insights.push({
      id:
        `module-risk-${module.module}`,

      type:
        "module_risk",

      severity,

      title:
        `${module.module} requires attention`,

      description:
        `${module.agentsBelowTarget} of ${module.agentsMeasured} assessed agents are currently below the ${COACHING_THRESHOLDS.competencyThreshold}% competency target in ${module.module}.`,

      affectedAgents:
        module.agentsBelowTarget,

      module:
        module.module,
    });
  }

  /* =======================================================
     MOST COMMON KNOWLEDGE GAP
     ======================================================= */

  if (
    mostCommonKnowledgeGap &&
    mostCommonKnowledgeGap.count > 0
  ) {
    const affectedAgents =
      assessedCompetencies.filter(
        (competency) =>
          competency.knowledgeGaps.some(
            (gap) =>
              gap.category ===
              mostCommonKnowledgeGap.category
          )
      ).length;

    insights.push({
      id:
        `knowledge-gap-${mostCommonKnowledgeGap.category}`,

      type:
        "knowledge_gap",

      severity:
        "medium",

      title:
        `${mostCommonKnowledgeGap.category} is the most common knowledge gap`,

      description:
        `${mostCommonKnowledgeGap.count} reviewed below-threshold answers were categorized as ${mostCommonKnowledgeGap.category}.`,

      affectedAgents,

      knowledgeGapCategory:
        mostCommonKnowledgeGap.category,
    });
  }

  /* =======================================================
     IMPROVING AGENTS
     ======================================================= */

  if (
    improvingAgents > 0
  ) {
    insights.push({
      id:
        "agents-improving",

      type:
        "improvement",

      severity:
        "positive",

      title:
        `${improvingAgents} ${
          improvingAgents === 1
            ? "agent is"
            : "agents are"
        } improving`,

      description:
        "These agents show a positive change between their first and latest reviewed assessment scores.",

      affectedAgents:
        improvingAgents,
    });
  }

  /* =======================================================
     DECLINING AGENTS
     ======================================================= */

  if (
    decliningAgents > 0
  ) {
    insights.push({
      id:
        "agents-declining",

      type:
        "decline",

      severity:
        decliningAgents >= 2
          ? "high"
          : "medium",

      title:
        `${decliningAgents} ${
          decliningAgents === 1
            ? "agent is"
            : "agents are"
        } declining`,

      description:
        "These agents show a meaningful decrease between their first and latest reviewed assessment scores.",

      affectedAgents:
        decliningAgents,
    });
  }

  /* =======================================================
     ACTIVE COACHING QUEUE
     ======================================================= */

  const activeCoachingCount =
    highPriorityAgents +
    mediumPriorityAgents;

  if (
    activeCoachingCount > 0
  ) {
    insights.push({
      id:
        "coaching-queue",

      type:
        "coaching_queue",

      severity:
        highPriorityAgents > 0
          ? "high"
          : "medium",

      title:
        "Active coaching queue",

      description:
        `${highPriorityAgents} high-priority and ${mediumPriorityAgents} medium-priority ${
          activeCoachingCount === 1
            ? "agent currently requires"
            : "agents currently require"
        } coaching attention.`,

      affectedAgents:
        activeCoachingCount,
    });
  }

  /* =======================================================
     SORT INSIGHTS BY IMPORTANCE
     ======================================================= */

  const severityOrder: Record<
    TeamCoachingInsightSeverity,
    number
  > = {
    high: 0,
    medium: 1,
    positive: 2,
    info: 3,
  };

  insights.sort(
    (a, b) =>
      severityOrder[a.severity] -
      severityOrder[b.severity]
  );

  return {
    totalAssessedAgents:
      assessedCompetencies.length,

    highPriorityAgents,

    mediumPriorityAgents,

    healthyAgents,

    improvingAgents,

    decliningAgents,

    mostCommonKnowledgeGap,

    moduleRisks,

    insights,
  };
}