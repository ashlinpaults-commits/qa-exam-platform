import * as XLSX from "xlsx";
import type {
  AppUser,
  Exam,
  ExamAttempt,
  Question,
  KnowledgeGapCategory,
  ExamMasterScorecard,
  AttemptProgressionStep,
  QuestionMasteryRecord,
} from "@/types";
import {
  calculateAgentCompetency,
  calculateCoachingAssessment,
  getAnswerPercentage,
  getAttemptScorePercentage,
  COMPETENCY_THRESHOLDS,
  type AgentCompetency,
  type AgentCoachingAssessment,
  type LearningTrend,
} from "./competency";
import { computeMergedScorecard, computeExamMasterScorecard } from "./attempts";

/* =========================================================
   REPORT TYPES & DATA STRUCTURES
   ========================================================= */

export interface AgentReportSummary {
  agentId: string;
  name: string;
  email: string;
  overallScore: number | null;
  competencyScore: number | null;
  totalTestsAssigned: number;
  testsAttempted: number;
  testsCompleted: number;
  testsPending: number;
  testsArchived: number;
  totalAttempts: number;
  reviewedAttemptsCount: number;
  averageScore: number | null;
  highestScore: number | null;
  lowestScore: number | null;
  totalQuestionsAttempted: number;
  correctAnswers: number;
  incorrectAnswers: number;
  totalMarksEarned: number;
  totalPossibleMarks: number;
  averageTimeTakenSeconds: number | null;
  completionRate: number;
}

export interface AgentAttemptRecord {
  id: string;
  examId: string;
  attemptNumber: number;
  score: number | null;
  percentage: number | null;
  attemptScore?: number | null;
  totalMarks: number | null;
  maxTotalMarks: number | null;
  cumulativeMasterScore?: number | null;
  masterTotalMarks?: number | null;
  cumulativePercentage?: number | null;
  progressGain?: number | null;
  questionsMastered?: number | null;
  rawAttemptMarks?: number | null;
  rawAttemptMaxMarks?: number | null;
  rawAttemptScore?: number | null;
  timeTakenSeconds?: number;
  submittedAt?: number;
  reviewedAt?: number;
  status: ExamAttempt["status"];
  isReattempt: boolean;
  reattemptSource?: string;
  isArchivedExam: boolean;
}

export interface AgentExamPerformance {
  examId: string;
  examName: string;
  category?: string;
  assessmentMode?: string;
  mode: "normal" | "until_perfect";
  status: Exam["status"];
  isArchived: boolean;
  assignedDate?: number;
  attemptsTaken: number;
  latestAttemptScore: number | null;
  bestScore: number | null;
  averageScore: number | null;
  totalMarks: number | null;
  maxMarks: number | null;
  percentage: number | null;
  masterScore: number | null;
  masterTotalMarks: number | null;
  masterPercentage: number | null;
  latestAttemptGain: number | null;
  questionsMastered: number;
  questionsRemaining: number;
  timeTakenSeconds: number | null;
  reviewStatus: "Reviewed" | "Awaiting Review" | "In Progress" | "Not Attempted";
  completionStatus: "Completed" | "Pending" | "Not Attempted";
  attempts: AgentAttemptRecord[];
  masterScorecard: ExamMasterScorecard | null;
  mergedScorecard: ReturnType<typeof computeMergedScorecard>;
}

export interface AgentMissedQuestion {
  questionId: string;
  questionText: string;
  module: string;
  feature: string;
  questionType: string;
  timesAttempted: number;
  timesIncorrect: number;
  incorrectPct: number;
  latestResult: "Correct" | "Incorrect";
  latestScore: number;
  latestMaxMarks: number;
  knowledgeGapCategory?: KnowledgeGapCategory;
  eventuallyMastered: boolean;
  progressionDisplay: string;
}

export interface ScoreProgressionPoint {
  attemptId: string;
  examId: string;
  examName: string;
  attemptNumber: number;
  scorePct: number;
  timestamp: number;
  formattedDate: string;
}

export interface AgentPerformanceReportData {
  agent: AppUser;
  summary: AgentReportSummary;
  examPerformances: AgentExamPerformance[];
  frequentlyMissedQuestions: AgentMissedQuestion[];
  competency: AgentCompetency;
  coaching: AgentCoachingAssessment;
  progression: ScoreProgressionPoint[];
  trend: LearningTrend;
  trendVelocity: number | null;
  generatedAt: number;
}

/* =========================================================
   HELPER UTILITIES
   ========================================================= */

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0s";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins}m`;
  return `${mins}m ${secs}s`;
}

export function formatTimeTaken(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || seconds <= 0) return "-";
  return formatDuration(seconds);
}

/* =========================================================
   BUILD AGENT PERFORMANCE REPORT
   ========================================================= */

export function buildAgentPerformanceReport({
  agent,
  exams,
  attempts,
  questions,
}: {
  agent: AppUser;
  exams: Exam[];
  attempts: ExamAttempt[];
  questions: Question[];
}): AgentPerformanceReportData {
  const agentId = agent.uid;

  // Filter attempts belonging strictly to this agent
  const agentAttempts = attempts
    .filter((a) => a.agentId === agentId)
    .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0));

  const questionMap = new Map<string, Question>(
    questions.map((q) => [q.id, q])
  );

  const examMap = new Map<string, Exam>(
    exams.map((e) => [e.id, e])
  );

  // Compute Core Competency & Coaching Assessments using existing verified engine
  const competency = calculateAgentCompetency({
    agentId,
    attempts,
    questions,
    agent,
  });

  const coaching = calculateCoachingAssessment(competency);

  /* ---------------------------------------------------------
     EXAM-LEVEL PERFORMANCE
     --------------------------------------------------------- */
  // Assigned exams for this agent (published/active or any assigned exams)
  const assignedExams = exams.filter((e) =>
    (e.assignedAgentIds || []).includes(agentId)
  );

  // Also include any unassigned exams where the agent has historical attempts
  const attemptedExamIds = new Set(agentAttempts.map((a) => a.examId));
  const allRelevantExams = Array.from(
    new Set([...assignedExams.map((e) => e.id), ...attemptedExamIds])
  )
    .map((id) => examMap.get(id))
    .filter((e): e is Exam => Boolean(e));

  // Sort exams: active/published first, then name
  allRelevantExams.sort((a, b) => {
    if (a.status === "archived" && b.status !== "archived") return 1;
    if (a.status !== "archived" && b.status === "archived") return -1;
    return a.name.localeCompare(b.name);
  });

  const attemptProgressionStepMap = new Map<string, AttemptProgressionStep>();

  const examPerformances: AgentExamPerformance[] = allRelevantExams.map((exam) => {
    const isArchived = exam.status === "archived";
    const examAttempts = agentAttempts
      .filter((a) => a.examId === exam.id)
      .sort((a, b) => (a.attemptNumber || 0) - (b.attemptNumber || 0));

    const reviewedAttempts = examAttempts.filter((a) => a.status === "reviewed");
    const latestAttempt = examAttempts[examAttempts.length - 1];
    const latestReviewed = reviewedAttempts[reviewedAttempts.length - 1];

    // Authoritative Master Scorecard
    const masterScorecard = computeExamMasterScorecard(exam, examAttempts);
    masterScorecard.progression.forEach((step) => attemptProgressionStepMap.set(step.attemptId, step));

    // Compute mode-aware completion status matching ExamResultsScreen
    const completed = masterScorecard.isCompleted;

    // Determine review status
    let reviewStatus: AgentExamPerformance["reviewStatus"] = "Not Attempted";
    if (examAttempts.length > 0) {
      if (latestAttempt?.status === "reviewed") {
        reviewStatus = "Reviewed";
      } else if (
        latestAttempt?.status === "submitted" ||
        latestAttempt?.status === "review_in_progress"
      ) {
        reviewStatus = "Awaiting Review";
      } else {
        reviewStatus = "In Progress";
      }
    }

    const completionStatus: AgentExamPerformance["completionStatus"] =
      completed
        ? "Completed"
        : examAttempts.length > 0
        ? "Pending"
        : "Not Attempted";

    // Attempt scores (in isolation)
    const reviewedPercentages = reviewedAttempts
      .map((a) => getAttemptScorePercentage(a))
      .filter((p): p is number => p !== null);

    const latestAttemptScore = latestReviewed
      ? getAttemptScorePercentage(latestReviewed)
      : null;

    const bestScore =
      reviewedPercentages.length > 0 ? Math.max(...reviewedPercentages) : null;

    const averageScore =
      reviewedPercentages.length > 0
        ? round(
            reviewedPercentages.reduce((s, p) => s + p, 0) /
              reviewedPercentages.length
          )
        : null;

    // Master Score & Master Total Marks
    const masterScore = masterScorecard.reviewedAttemptsCount > 0 ? masterScorecard.currentMasterScore : null;
    const masterTotalMarks = masterScorecard.masterTotalMarks;
    const masterPercentage = masterScorecard.reviewedAttemptsCount > 0 ? masterScorecard.masterPercentage : null;
    const latestAttemptGain = masterScorecard.latestAttemptGain;
    const questionsMastered = masterScorecard.questionsMastered;
    const questionsRemaining = masterScorecard.questionsRemaining;

    // Backward-compatible aliases
    const totalMarks = masterScore;
    const maxMarks = masterTotalMarks;
    const percentage = masterPercentage;

    // Average time taken across completed attempts
    const validTimes = examAttempts
      .map((a) => a.timeTakenSeconds)
      .filter((t): t is number => typeof t === "number" && t > 0);
    const timeTakenSeconds =
      validTimes.length > 0
        ? Math.round(validTimes.reduce((s, t) => s + t, 0) / validTimes.length)
        : null;

    const attemptRecords: AgentAttemptRecord[] = examAttempts.map((a) => {
      const rawPct = getAttemptScorePercentage(a);
      const step = masterScorecard.progression.find(
        (p: AttemptProgressionStep) => p.attemptId === a.id || p.attemptNumber === a.attemptNumber
      );

      // In this progressive model, an attempt's score MUST represent the agent's
      // CURRENT MASTER EXAM SCORE at that point in the progression (e.g. 78.6% and 110/140).
      const currentScorePct = step ? step.cumulativePercentage : rawPct;
      const currentMarks = step ? step.cumulativeMasterScore : (a.totalMarks ?? null);
      const currentMaxMarks = masterScorecard.masterTotalMarks > 0 ? masterScorecard.masterTotalMarks : (a.maxTotalMarks ?? null);

      return {
        id: a.id,
        examId: a.examId,
        attemptNumber: a.attemptNumber,
        score: currentScorePct,
        percentage: currentScorePct,
        attemptScore: currentScorePct,
        totalMarks: currentMarks,
        maxTotalMarks: currentMaxMarks,
        cumulativeMasterScore: step?.cumulativeMasterScore ?? null,
        masterTotalMarks: masterScorecard.masterTotalMarks,
        cumulativePercentage: step?.cumulativePercentage ?? null,
        progressGain: step?.progressGain ?? null,
        questionsMastered: step?.questionsMasteredSoFar ?? null,
        rawAttemptMarks: a.totalMarks ?? null,
        rawAttemptMaxMarks: a.maxTotalMarks ?? null,
        rawAttemptScore: rawPct,
        timeTakenSeconds: a.timeTakenSeconds,
        submittedAt: a.submittedAt,
        reviewedAt: a.reviewedAt,
        status: a.status,
        isReattempt: Boolean(a.isReattempt || a.attemptNumber > 1),
        reattemptSource: a.reattemptSource,
        isArchivedExam: isArchived,
      };
    });

    const merged = computeMergedScorecard(exam, examAttempts);

    return {
      examId: exam.id,
      examName: exam.name,
      category: exam.category,
      assessmentMode: exam.assessmentMode,
      mode: exam.mode,
      status: exam.status,
      isArchived,
      assignedDate: exam.createdAt,
      attemptsTaken: examAttempts.length,
      latestAttemptScore,
      bestScore,
      averageScore,
      totalMarks,
      maxMarks,
      percentage,
      masterScore,
      masterTotalMarks,
      masterPercentage,
      latestAttemptGain,
      questionsMastered,
      questionsRemaining,
      timeTakenSeconds,
      reviewStatus,
      completionStatus,
      attempts: attemptRecords,
      masterScorecard,
      mergedScorecard: merged,
    };
  });

  /* ---------------------------------------------------------
     SECTION 1 & 7: AGENT SUMMARY & OVERALL AGENT SCORE
     --------------------------------------------------------- */
  const activeAssignedExams = assignedExams.filter((e) => e.status !== "archived");
  const totalTestsAssigned = activeAssignedExams.length;

  // Tests attempted (at least 1 attempt) among assigned
  const testsAttempted = activeAssignedExams.filter((e) =>
    agentAttempts.some((a) => a.examId === e.id)
  ).length;

  // Tests completed among assigned
  const testsCompleted = activeAssignedExams.filter((e) => {
    const perf = examPerformances.find((p) => p.examId === e.id);
    return perf?.completionStatus === "Completed";
  }).length;

  const testsPending = Math.max(0, totalTestsAssigned - testsCompleted);
  const testsArchived = allRelevantExams.filter((e) => e.status === "archived").length;

  // Reviewed attempts (excluding unreviewed/in-progress)
  const allReviewedAttempts = agentAttempts.filter((a) => a.status === "reviewed");
  const reviewedAttemptsCount = allReviewedAttempts.length;

  // Eligible non-archived reviewed exams for Master Score aggregation
  const eligibleReviewedExams = examPerformances.filter(
    (p) => !p.isArchived && p.masterScorecard && p.masterScorecard.reviewedAttemptsCount > 0
  );

  const totalMarksEarned = eligibleReviewedExams.reduce(
    (sum, p) => sum + (p.masterScore ?? 0),
    0
  );

  const totalPossibleMarks = eligibleReviewedExams.reduce(
    (sum, p) => sum + (p.masterTotalMarks ?? 0),
    0
  );

  // Cross-Exam Overall Score Calculation:
  // Formula: Total Master Marks Earned Across Eligible Reviewed Exams / Total Master Possible Marks * 100
  const overallScore =
    totalPossibleMarks > 0
      ? round((totalMarksEarned / totalPossibleMarks) * 100)
      : null;

  const masterPercentages = eligibleReviewedExams
    .map((p) => p.masterPercentage)
    .filter((p): p is number => p !== null);

  const averageScore =
    masterPercentages.length > 0
      ? round(masterPercentages.reduce((s, p) => s + p, 0) / masterPercentages.length)
      : null;

  const highestScore =
    masterPercentages.length > 0 ? Math.max(...masterPercentages) : null;
  const lowestScore =
    masterPercentages.length > 0 ? Math.min(...masterPercentages) : null;

  // Question-level metrics across unique questions in eligible reviewed exams
  let totalQuestionsAttempted = 0;
  let correctAnswers = 0;
  eligibleReviewedExams.forEach((p) => {
    if (p.masterScorecard) {
      const attempted = p.masterScorecard.questionMastery.filter((q) => q.timesAttempted > 0).length;
      totalQuestionsAttempted += attempted;
      correctAnswers += p.masterScorecard.questionsMastered;
    }
  });
  const incorrectAnswers = Math.max(0, totalQuestionsAttempted - correctAnswers);

  // Average Time Taken across all submitted attempts
  const allTimeTakens = agentAttempts
    .map((a) => a.timeTakenSeconds)
    .filter((t): t is number => typeof t === "number" && t > 0);
  const averageTimeTakenSeconds =
    allTimeTakens.length > 0
      ? Math.round(allTimeTakens.reduce((s, t) => s + t, 0) / allTimeTakens.length)
      : null;

  // Completion Rate = Completed Eligible Tests / Assigned Eligible Tests * 100
  const completionRate =
    totalTestsAssigned > 0
      ? round((testsCompleted / totalTestsAssigned) * 100)
      : 0;

  const summary: AgentReportSummary = {
    agentId,
    name: agent.name || "Agent",
    email: agent.email || "",
    overallScore,
    competencyScore: competency.competencyScore,
    totalTestsAssigned,
    testsAttempted,
    testsCompleted,
    testsPending,
    testsArchived,
    totalAttempts: agentAttempts.length,
    reviewedAttemptsCount,
    averageScore,
    highestScore,
    lowestScore,
    totalQuestionsAttempted,
    correctAnswers,
    incorrectAnswers,
    totalMarksEarned,
    totalPossibleMarks,
    averageTimeTakenSeconds,
    completionRate,
  };

  /* ---------------------------------------------------------
     SECTION 5: FREQUENTLY MISSED QUESTIONS (AGENT-SPECIFIC)
     --------------------------------------------------------- */
  const questionHistoryMap = new Map<
    string,
    {
      questionId: string;
      questionSnapshot?: Question;
      timesAttempted: number;
      timesIncorrect: number;
      bestMarks: number;
      latestMarks: number;
      latestMaxMarks: number;
      latestCategory?: KnowledgeGapCategory;
      latestResult: "Correct" | "Incorrect";
      progressionStates: string[];
    }
  >();

  // Iterate chronologically through eligible reviewed attempts
  for (const attempt of allReviewedAttempts) {
    const examSnapshots = examMap.get(attempt.examId)?.questionSnapshots;

    for (const ans of attempt.answers || []) {
      if (ans.marks === undefined) continue;

      const existing = questionHistoryMap.get(ans.questionId) || {
        questionId: ans.questionId,
        questionSnapshot: ans.questionSnapshot || examSnapshots?.[ans.questionId] || questionMap.get(ans.questionId),
        timesAttempted: 0,
        timesIncorrect: 0,
        bestMarks: 0,
        latestMarks: 0,
        latestMaxMarks: ans.maxMarks || 10,
        latestResult: "Incorrect" as const,
        latestCategory: ans.knowledgeGapCategory,
        progressionStates: [],
      };

      existing.timesAttempted += 1;
      const maxMarks = ans.maxMarks || 10;
      const isCorrect = (ans.marks / maxMarks) >= 0.70;
      if (!isCorrect) {
        existing.timesIncorrect += 1;
      }
      existing.progressionStates.push(isCorrect ? "Correct" : "Incorrect");
      existing.bestMarks = Math.max(existing.bestMarks, ans.marks);
      existing.latestMarks = ans.marks;
      existing.latestMaxMarks = maxMarks;
      existing.latestResult = isCorrect ? "Correct" : "Incorrect";
      if (ans.knowledgeGapCategory) {
        existing.latestCategory = ans.knowledgeGapCategory;
      }

      questionHistoryMap.set(ans.questionId, existing);
    }
  }

  const frequentlyMissedQuestions: AgentMissedQuestion[] = Array.from(questionHistoryMap.values())
    .filter((record) => record.timesIncorrect > 0)
    .map((record) => {
      const q = record.questionSnapshot || questionMap.get(record.questionId);
      const incorrectPct = Math.round((record.timesIncorrect / record.timesAttempted) * 100);
      const eventuallyMastered = (record.bestMarks / record.latestMaxMarks) >= 0.70;
      const progressionDisplay = record.progressionStates.join(" → ");

      return {
        questionId: record.questionId,
        questionText: q?.questionText?.trim() || "Question text unavailable",
        module: q?.module || "General",
        feature: q?.feature || "General",
        questionType: q?.type || "descriptive",
        timesAttempted: record.timesAttempted,
        timesIncorrect: record.timesIncorrect,
        incorrectPct,
        latestResult: record.latestResult,
        latestScore: record.latestMarks,
        latestMaxMarks: record.latestMaxMarks,
        knowledgeGapCategory: record.latestCategory,
        eventuallyMastered,
        progressionDisplay,
      };
    })
    .sort((a, b) => {
      // Prioritize unresolved weaknesses over eventually mastered
      if (a.eventuallyMastered !== b.eventuallyMastered) {
        return a.eventuallyMastered ? 1 : -1;
      }
      if (b.timesIncorrect !== a.timesIncorrect) {
        return b.timesIncorrect - a.timesIncorrect;
      }
      return b.incorrectPct - a.incorrectPct;
    });

  /* ---------------------------------------------------------
     SECTION 8: SCORE PROGRESSION & PERFORMANCE TREND
     --------------------------------------------------------- */
  const progression: ScoreProgressionPoint[] = allReviewedAttempts
    .map((a) => {
      const step = attemptProgressionStepMap.get(a.id);
      const scorePct = step ? step.cumulativePercentage : (getAttemptScorePercentage(a) ?? 0);
      const examName = examMap.get(a.examId)?.name || "Assessment";
      const timestamp = a.reviewedAt || a.submittedAt || a.startedAt;
      return {
        attemptId: a.id,
        examId: a.examId,
        examName,
        attemptNumber: a.attemptNumber,
        scorePct: scorePct ?? 0,
        timestamp,
        formattedDate: new Date(timestamp).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  return {
    agent,
    summary,
    examPerformances,
    frequentlyMissedQuestions,
    competency,
    coaching,
    progression,
    trend: competency.learningTrend,
    trendVelocity: competency.learningVelocity,
    generatedAt: Date.now(),
  };
}

/* =========================================================
   EXCEL EXPORT IMPLEMENTATION (REUSING EXISTING xlsx)
   ========================================================= */

export function exportAgentReportsToExcel(
  reports: AgentPerformanceReportData[],
  filename = "agent_performance_report.xlsx"
) {
  const wb = XLSX.utils.book_new();

  // Sheet 1: High-Level Summary of Selected Agents
  const summaryRows = reports.map((r) => ({
    "Agent Name": r.agent.name || "Agent",
    "Agent Email": r.agent.email || "",
    "Overall Score (%)": r.summary.overallScore !== null ? `${r.summary.overallScore}%` : "N/A",
    "Competency Score (%)": r.summary.competencyScore !== null ? `${r.summary.competencyScore}%` : "N/A",
    "Tests Assigned": r.summary.totalTestsAssigned,
    "Tests Attempted": r.summary.testsAttempted,
    "Tests Completed": r.summary.testsCompleted,
    "Tests Pending": r.summary.testsPending,
    "Completion Rate (%)": `${r.summary.completionRate}%`,
    "Total Attempts": r.summary.totalAttempts,
    "Reviewed Attempts": r.summary.reviewedAttemptsCount,
    "Average Score (%)": r.summary.averageScore !== null ? `${r.summary.averageScore}%` : "N/A",
    "Highest Score (%)": r.summary.highestScore !== null ? `${r.summary.highestScore}%` : "N/A",
    "Lowest Score (%)": r.summary.lowestScore !== null ? `${r.summary.lowestScore}%` : "N/A",
    "Questions Attempted": r.summary.totalQuestionsAttempted,
    "Correct Answers": r.summary.correctAnswers,
    "Incorrect Answers": r.summary.incorrectAnswers,
    "Marks Earned": r.summary.totalMarksEarned,
    "Possible Marks": r.summary.totalPossibleMarks,
    "Average Time": formatTimeTaken(r.summary.averageTimeTakenSeconds),
    "Learning Trend": r.trend,
    "Trend Velocity (%)": r.trendVelocity !== null ? `${r.trendVelocity > 0 ? "+" : ""}${r.trendVelocity}%` : "N/A",
    "Coaching Priority": r.coaching.priority,
  }));
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, "Agent Summary");

  // Sheet 2: Exam-Level Details
  const examRows: Record<string, unknown>[] = [];
  reports.forEach((r) => {
    r.examPerformances.forEach((p) => {
      examRows.push({
        "Agent Name": r.agent.name || "Agent",
        "Agent Email": r.agent.email || "",
        "Exam Name": p.examName,
        Category: p.category || "General",
        Mode: p.mode === "until_perfect" ? "Until Perfect" : "Normal",
        "Exam Status": p.status,
        "Is Archived": p.isArchived ? "Yes" : "No",
        "Attempts Taken": p.attemptsTaken,
        "Master Score": p.masterScore !== null ? p.masterScore : "N/A",
        "Master Total": p.masterTotalMarks,
        "Master Progress (%)": p.masterPercentage !== null ? `${p.masterPercentage}%` : "N/A",
        "Latest Attempt Gain": p.latestAttemptGain !== null ? (p.latestAttemptGain > 0 ? `+${p.latestAttemptGain}` : `${p.latestAttemptGain}`) : "N/A",
        "Questions Mastered": p.questionsMastered,
        "Questions Remaining": p.questionsRemaining,
        "Latest Attempt Score (%)": p.latestAttemptScore !== null ? `${p.latestAttemptScore}%` : "N/A",
        "Best Attempt Score (%)": p.bestScore !== null ? `${p.bestScore}%` : "N/A",
        "Average Attempt Score (%)": p.averageScore !== null ? `${p.averageScore}%` : "N/A",
        "Average Time": formatTimeTaken(p.timeTakenSeconds),
        "Review Status": p.reviewStatus,
        "Completion Status": p.completionStatus,
      });
    });
  });
  if (examRows.length > 0) {
    const wsExams = XLSX.utils.json_to_sheet(examRows);
    XLSX.utils.book_append_sheet(wb, wsExams, "Exam Performance");
  }

  // Sheet 3: Agent Frequently Missed Questions
  const missedRows: Record<string, unknown>[] = [];
  reports.forEach((r) => {
    r.frequentlyMissedQuestions.forEach((q) => {
      missedRows.push({
        "Agent Name": r.agent.name || "Agent",
        Module: q.module,
        Feature: q.feature,
        Question: q.questionText,
        Type: q.questionType,
        "Times Attempted": q.timesAttempted,
        "Times Incorrect": q.timesIncorrect,
        "Incorrect Rate (%)": `${q.incorrectPct}%`,
        "Latest Result": q.latestResult,
        "Latest Score": `${q.latestScore}/${q.latestMaxMarks}`,
        "Knowledge Gap Category": q.knowledgeGapCategory || "Uncategorized",
        "Progression": q.progressionDisplay || "N/A",
        "Eventually Mastered": q.eventuallyMastered ? "Yes" : "No",
      });
    });
  });
  if (missedRows.length > 0) {
    const wsMissed = XLSX.utils.json_to_sheet(missedRows);
    XLSX.utils.book_append_sheet(wb, wsMissed, "Frequently Missed Questions");
  }

  // Sheet 4: Progressive Attempt History
  const attemptHistoryRows: Record<string, unknown>[] = [];
  reports.forEach((r) => {
    r.examPerformances.forEach((p) => {
      p.attempts.forEach((a) => {
        attemptHistoryRows.push({
          "Agent Name": r.agent.name || "Agent",
          "Agent Email": r.agent.email || "",
          "Exam Name": p.examName,
          "Attempt Number": a.attemptNumber,
          "Type": a.isReattempt ? "Retake" : "Original",
          "Current Exam Score (%)": a.score !== null ? `${a.score}%` : "N/A",
          "Master Progress": a.cumulativeMasterScore !== null ? `${a.cumulativeMasterScore} / ${a.masterTotalMarks}` : "N/A",
          "Progress Gain": a.progressGain !== null && a.progressGain !== undefined ? (a.progressGain > 0 ? `+${a.progressGain}` : `${a.progressGain}`) : "N/A",
          "This Attempt Score": a.isReattempt && a.rawAttemptMarks !== null && a.rawAttemptMarks !== undefined
            ? `${a.rawAttemptMarks} / ${a.rawAttemptMaxMarks} (${a.rawAttemptScore ?? "—"}%)`
            : a.rawAttemptMarks !== null && a.rawAttemptMarks !== undefined
            ? `${a.rawAttemptMarks} / ${a.rawAttemptMaxMarks} (${a.rawAttemptScore ?? "—"}%)`
            : "N/A",
          "Status": a.status,
          "Time": formatTimeTaken(a.timeTakenSeconds),
          "Submitted At": a.submittedAt ? new Date(a.submittedAt).toLocaleDateString() : "N/A",
        });
      });
    });
  });
  if (attemptHistoryRows.length > 0) {
    const wsAttempts = XLSX.utils.json_to_sheet(attemptHistoryRows);
    XLSX.utils.book_append_sheet(wb, wsAttempts, "Attempt History");
  }

  // Write file to client browser
  XLSX.writeFile(wb, filename);
}
