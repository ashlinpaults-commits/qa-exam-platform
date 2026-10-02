import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type {
  AppUser,
  Exam,
  ExamAttempt,
  Question,
  KnowledgeGapCategory,
  ExamMasterScorecard,
  AttemptProgressionStep,
} from "@/types";
import {
  calculateAgentCompetency,
  calculateCoachingAssessment,
  getAttemptScorePercentage,
} from "./competency";
import { computeExamMasterScorecard } from "./attempts";
import { normalizeLegacyModule, classifyQuestionTaxonomy } from "@/config/taxonomy";
import { formatTimeTaken } from "./agentReports";

/* =========================================================
   REPORT 2.0 DATA TYPES & INTERFACES
   Strictly aligned with the supplied Excel Template:
   - Sheet 1: Agent Summary (18 columns)
   - Sheet 2: Exam Performance (19 columns)
   - Sheet 3: Frequently Missed Questions (13 columns)
   - Sheet 4: Attempt History (12 columns)
   - Sheet 5: Overall (Empty sheet)
   ========================================================= */

export interface Report2FilterOptions {
  agentIds?: string[]; // If empty or undefined, all agents
  examIds?: string[]; // If empty or undefined, all exams
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
}

export interface Report2AgentSummaryRow {
  "Agent Name": string;
  "Agent Email": string;
  "Overall Score (%)": string;
  "Tests Assigned": number;
  "Tests Attempted": number;
  "Tests Completed": number;
  "Completion Rate (%)": string;
  "Total Attempts": number;
  "Average Score (%)": string;
  "Highest Score (%)": string;
  "Lowest Score (%)": string;
  "Questions Attempted": number;
  "Correct Answers": number;
  "Marks Earned": number;
  "Possible Marks": number;
  "Average Time": string;
  "Strongest Topic": string;
  "Weakest Topic": string;
}

export interface Report2ExamPerformanceRow {
  "Agent Name": string;
  "Agent Email": string;
  "Exam Name": string;
  Category: string;
  Mode: string;
  "Exam Status": string;
  "Is Archived": string;
  "Attempts Taken": number;
  "Master Score": number | string;
  "Master Total": number | string;
  "Master Progress (%)": string;
  "Latest Attempt Gain": string;
  "Questions Mastered": number;
  "Questions Remaining": number;
  "Latest Attempt Score (%)": string;
  "Best Attempt Score (%)": string;
  "Average Attempt Score (%)": string;
  "Average Time": string;
  "Review Status": string;
}

export interface Report2MissedQuestionRow {
  "Agent Name": string;
  Module: string;
  Topic: string;
  Question: string;
  Type: string;
  "Times Attempted": number;
  "Times Incorrect": number;
  "Incorrect Rate (%)": string;
  "Latest Result": string;
  "Latest Score": string;
  "Knowledge Gap Category": string;
  Progression: string;
  "Eventually Mastered": string;
}

export interface Report2AttemptHistoryRow {
  "Agent Name": string;
  "Agent Email": string;
  "Exam Name": string;
  "Attempt Number": number;
  Type: string;
  "Current Exam Score (%)": string;
  "Master Progress": string;
  "Progress Gain": string;
  "This Attempt Score": string;
  Status: string;
  Time: string;
  "Submitted At": string;
}

export interface Report2Dataset {
  agentSummaries: Report2AgentSummaryRow[];
  examPerformances: Report2ExamPerformanceRow[];
  frequentlyMissedQuestions: Report2MissedQuestionRow[];
  attemptHistories: Report2AttemptHistoryRow[];
  filtersApplied: {
    agentCount: number;
    examCount: number;
    startDate?: string;
    endDate?: string;
  };
  generatedAt: number;
}

/* =========================================================
   SAFE FORMATTING HELPERS (ZERO / NULL / UNDEFINED SAFETY)
   Zero is a valid score and must never be converted to blank.
   ========================================================= */

function round(val: number, decimals = 1): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

function safePercentageString(val: number | null | undefined): string {
  if (val === null || val === undefined || isNaN(val)) return "N/A";
  return `${round(val, 1)}%`;
}

function safeScoreGainString(gain: number | null | undefined): string {
  if (gain === null || gain === undefined || isNaN(gain)) return "N/A";
  if (gain > 0) return `+${gain}`;
  return `${gain}`;
}

function isAttemptInDateRange(
  attempt: ExamAttempt,
  startDate?: string,
  endDate?: string
): boolean {
  if (!startDate && !endDate) return true;
  const timestamp = attempt.submittedAt || attempt.reviewedAt || attempt.startedAt;
  if (!timestamp) return false;

  if (startDate) {
    const startMs = new Date(startDate).setHours(0, 0, 0, 0);
    if (timestamp < startMs) return false;
  }
  if (endDate) {
    const endMs = new Date(endDate).setHours(23, 59, 59, 999);
    if (timestamp > endMs) return false;
  }
  return true;
}

/* =========================================================
   CORE BUILD FUNCTION: REPORT 2.0 DATA ENGINE
   Uses the authoritative cumulative master progress model.
   Handles reassignments, cancellations, amendments, zero values,
   and retrieves clean question text & taxonomy.
   ========================================================= */

export function buildReport2Dataset(params: {
  agents: AppUser[];
  exams: Exam[];
  attempts: ExamAttempt[];
  questions: Question[];
  filters?: Report2FilterOptions;
}): Report2Dataset {
  const { agents, exams, attempts, questions, filters } = params;

  const questionMap = new Map<string, Question>(questions.map((q) => [q.id, q]));
  const examMap = new Map<string, Exam>(exams.map((e) => [e.id, e]));

  // 1. Filter Agents
  let selectedAgents = agents.filter((u) => u.role === "agent");
  if (filters?.agentIds && filters.agentIds.length > 0) {
    const agentSet = new Set(filters.agentIds);
    selectedAgents = selectedAgents.filter((a) => agentSet.has(a.uid));
  }
  selectedAgents.sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));

  // 2. Filter Exams
  let selectedExams = exams;
  if (filters?.examIds && filters.examIds.length > 0) {
    const examSet = new Set(filters.examIds);
    selectedExams = selectedExams.filter((e) => examSet.has(e.id));
  }
  const selectedExamIds = new Set(selectedExams.map((e) => e.id));

  // 3. Filter Attempts by exam, date range, and exclusion of revoked attempts
  const validAttempts = attempts.filter((a) => {
    // Exclude revoked attempts
    if (a.status === "revoked") return false;
    // Must be in selected exams
    if (!selectedExamIds.has(a.examId)) return false;
    // Date range filter
    return isAttemptInDateRange(a, filters?.startDate, filters?.endDate);
  });

  const agentSummaries: Report2AgentSummaryRow[] = [];
  const examPerformances: Report2ExamPerformanceRow[] = [];
  const frequentlyMissedQuestions: Report2MissedQuestionRow[] = [];
  const attemptHistories: Report2AttemptHistoryRow[] = [];

  // Iterate over each selected agent to produce agent-specific report rows
  selectedAgents.forEach((agent) => {
    const agentName = (agent.name || "Agent").trim();
    const agentEmail = (agent.email || "").trim();

    // All valid attempts for this agent
    const agentAttempts = validAttempts.filter((a) => a.agentId === agent.uid);

    // Assigned exams for this agent among selected exams
    const agentAssignedExams = selectedExams.filter((e) =>
      (e.assignedAgentIds || []).includes(agent.uid)
    );

    // Also include any exam where the agent has attempts within the selected scope
    const agentAttemptedExamIds = new Set(agentAttempts.map((a) => a.examId));
    const allAgentRelevantExams = Array.from(
      new Set([...agentAssignedExams.map((e) => e.id), ...agentAttemptedExamIds])
    )
      .map((id) => examMap.get(id))
      .filter((e): e is Exam => Boolean(e));

    // Sort exams: active/published first, then alphabetically
    allAgentRelevantExams.sort((a, b) => {
      if (a.status === "archived" && b.status !== "archived") return 1;
      if (a.status !== "archived" && b.status === "archived") return -1;
      return a.name.localeCompare(b.name);
    });

    // Compute competency for topic strengths
    const competency = calculateAgentCompetency({
      agentId: agent.uid,
      attempts: agentAttempts,
      questions,
      agent,
    });

    // -------------------------------------------------------------
    // BUILD EXAM PERFORMANCE & ATTEMPT HISTORY ROWS FOR THIS AGENT
    // -------------------------------------------------------------
    const agentExamPerfList: {
      exam: Exam;
      masterScorecard: ExamMasterScorecard;
      reviewedCount: number;
      isCompleted: boolean;
      attemptsTaken: number;
      averageScore: number | null;
      bestScore: number | null;
      latestAttemptScore: number | null;
      averageTimeTakenSeconds: number | null;
      reviewStatus: string;
    }[] = [];

    // Question tracking for frequently missed questions
    interface QRecord {
      questionId: string;
      questionSnapshot?: Question;
      timesAttempted: number;
      timesIncorrect: number;
      bestMarks: number;
      latestMarks: number;
      latestMaxMarks: number;
      latestResult: "Correct" | "Incorrect";
      latestCategory?: KnowledgeGapCategory;
      progressionStates: string[];
    }
    const questionHistoryMap = new Map<string, QRecord>();

    allAgentRelevantExams.forEach((exam) => {
      const examAttempts = agentAttempts
        .filter((a) => a.examId === exam.id)
        .sort((a, b) => (a.attemptNumber || 0) - (b.attemptNumber || 0));

      const reviewedAttempts = examAttempts.filter((a) => a.status === "reviewed");
      const latestAttempt = examAttempts[examAttempts.length - 1];
      const latestReviewed = reviewedAttempts[reviewedAttempts.length - 1];

      // Authoritative Master Scorecard
      const masterScorecard = computeExamMasterScorecard(exam, examAttempts);

      // Map progression steps for fast lookup
      const progressionMap = new Map<string, AttemptProgressionStep>();
      masterScorecard.progression.forEach((step) => {
        progressionMap.set(step.attemptId, step);
      });

      // Review status
      let reviewStatus = "Not Attempted";
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

      // Completed status
      const isCompleted = masterScorecard.isCompleted;

      // Attempt percentage scores
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
          ? round(reviewedPercentages.reduce((s, p) => s + p, 0) / reviewedPercentages.length)
          : null;

      // Times
      const validTimes = examAttempts
        .map((a) => a.timeTakenSeconds)
        .filter((t): t is number => typeof t === "number" && t > 0);
      const avgTimeSecs =
        validTimes.length > 0
          ? Math.round(validTimes.reduce((s, t) => s + t, 0) / validTimes.length)
          : null;

      agentExamPerfList.push({
        exam,
        masterScorecard,
        reviewedCount: reviewedAttempts.length,
        isCompleted,
        attemptsTaken: examAttempts.length,
        averageScore,
        bestScore,
        latestAttemptScore,
        averageTimeTakenSeconds: avgTimeSecs,
        reviewStatus,
      });

      // Populate Sheet 2: Exam Performance
      examPerformances.push({
        "Agent Name": agentName,
        "Agent Email": agentEmail,
        "Exam Name": exam.name,
        Category: exam.category || "General",
        Mode: exam.mode === "until_perfect" ? "Perfect 10" : "Normal",
        "Exam Status": exam.status || "published",
        "Is Archived": exam.status === "archived" ? "Yes" : "No",
        "Attempts Taken": examAttempts.length,
        "Master Score": masterScorecard.reviewedAttemptsCount > 0 ? masterScorecard.currentMasterScore : "N/A",
        "Master Total": masterScorecard.masterTotalMarks > 0 ? masterScorecard.masterTotalMarks : "N/A",
        "Master Progress (%)":
          masterScorecard.reviewedAttemptsCount > 0
            ? `${masterScorecard.masterPercentage}%`
            : "N/A",
        "Latest Attempt Gain": safeScoreGainString(masterScorecard.latestAttemptGain),
        "Questions Mastered": masterScorecard.questionsMastered,
        "Questions Remaining": masterScorecard.questionsRemaining,
        "Latest Attempt Score (%)": safePercentageString(latestAttemptScore),
        "Best Attempt Score (%)": safePercentageString(bestScore),
        "Average Attempt Score (%)": safePercentageString(averageScore),
        "Average Time": formatTimeTaken(avgTimeSecs),
        "Review Status": reviewStatus,
      });

      // Populate Sheet 4: Attempt History
      examAttempts.forEach((att) => {
        const step = progressionMap.get(att.id) || masterScorecard.progression.find((p) => p.attemptNumber === att.attemptNumber);
        const rawScorePct = getAttemptScorePercentage(att);

        // Cumulative master score at this attempt
        const currentExamScoreStr = step
          ? `${step.cumulativePercentage}%`
          : safePercentageString(rawScorePct);

        const masterProgressStr = step
          ? `${step.cumulativeMasterScore} / ${step.masterTotalMarks}`
          : att.totalMarks !== undefined && att.maxTotalMarks !== undefined
          ? `${att.totalMarks} / ${att.maxTotalMarks}`
          : "N/A";

        const progressGainStr = step
          ? safeScoreGainString(step.progressGain)
          : "N/A";

        const rawMarks = att.totalMarks ?? 0;
        const rawMaxMarks = att.maxTotalMarks ?? 0;
        const thisAttemptScoreStr =
          att.status === "reviewed" || att.totalMarks !== undefined
            ? `${rawMarks} / ${rawMaxMarks} (${rawScorePct !== null ? `${rawScorePct}%` : "—"})`
            : "N/A";

        const formattedDate = att.submittedAt
          ? new Date(att.submittedAt).toLocaleDateString("en-US")
          : att.startedAt
          ? new Date(att.startedAt).toLocaleDateString("en-US")
          : "N/A";

        const isReattempt = Boolean(att.isReattempt || att.attemptNumber > 1);

        attemptHistories.push({
          "Agent Name": agentName,
          "Agent Email": agentEmail,
          "Exam Name": exam.name,
          "Attempt Number": att.attemptNumber || 1,
          Type: isReattempt ? "Retake" : "Original",
          "Current Exam Score (%)": currentExamScoreStr,
          "Master Progress": masterProgressStr,
          "Progress Gain": progressGainStr,
          "This Attempt Score": thisAttemptScoreStr,
          Status: att.status,
          Time: formatTimeTaken(att.timeTakenSeconds),
          "Submitted At": formattedDate,
        });

        // Track questions for Sheet 3 (Frequently Missed Questions)
        if (att.status === "reviewed") {
          att.answers.forEach((ans) => {
            const maxMarks = ans.maxMarks || 10;
            const marks = ans.marks ?? 0;
            const isCorrect = maxMarks > 0 && marks / maxMarks >= 0.7;

            const existing = questionHistoryMap.get(ans.questionId) || {
              questionId: ans.questionId,
              questionSnapshot: ans.questionSnapshot,
              timesAttempted: 0,
              timesIncorrect: 0,
              bestMarks: 0,
              latestMarks: 0,
              latestMaxMarks: maxMarks,
              latestResult: "Incorrect" as const,
              latestCategory: ans.knowledgeGapCategory,
              progressionStates: [],
            };

            existing.timesAttempted += 1;
            if (!isCorrect) {
              existing.timesIncorrect += 1;
            }
            if (marks > existing.bestMarks) {
              existing.bestMarks = marks;
            }
            existing.progressionStates.push(isCorrect ? "Correct" : "Incorrect");
            existing.latestMarks = marks;
            existing.latestMaxMarks = maxMarks;
            existing.latestResult = isCorrect ? "Correct" : "Incorrect";
            if (ans.knowledgeGapCategory) {
              existing.latestCategory = ans.knowledgeGapCategory;
            }
            questionHistoryMap.set(ans.questionId, existing);
          });
        }
      });
    });

    // Populate Sheet 3: Frequently Missed Questions for this agent
    const missedList = Array.from(questionHistoryMap.values())
      .filter((rec) => rec.timesIncorrect > 0)
      .map((rec) => {
        const liveQ = questionMap.get(rec.questionId);
        const snap = rec.questionSnapshot;
        const q = liveQ || snap;

        const normModule = normalizeLegacyModule(q?.module || snap?.module || "General");
        let cleanTopic = (liveQ?.topic || liveQ?.feature || snap?.topic || snap?.feature || "").trim();

        if (
          !cleanTopic ||
          cleanTopic.toLowerCase().includes("0909") ||
          cleanTopic.toLowerCase().includes("0109") ||
          cleanTopic.toLowerCase().includes("0209") ||
          cleanTopic.toLowerCase() === "sheet1" ||
          cleanTopic.toLowerCase() === normModule.toLowerCase()
        ) {
          const classified = classifyQuestionTaxonomy(
            q?.questionText || "",
            q?.expectedAnswer || "",
            normModule,
            cleanTopic
          );
          cleanTopic = classified.suggestedTopic;
        }

        const incorrectPct = Math.round((rec.timesIncorrect / rec.timesAttempted) * 100);
        const eventuallyMastered = rec.bestMarks / rec.latestMaxMarks >= 0.7;
        const progressionDisplay = rec.progressionStates.join(" → ");

        return {
          "Agent Name": agentName,
          Module: normModule,
          Topic: cleanTopic,
          Question: q?.questionText?.trim() || `Question ID: ${rec.questionId}`,
          Type: q?.type || "descriptive",
          "Times Attempted": rec.timesAttempted,
          "Times Incorrect": rec.timesIncorrect,
          "Incorrect Rate (%)": `${incorrectPct}%`,
          "Latest Result": rec.latestResult,
          "Latest Score": `${rec.latestMarks}/${rec.latestMaxMarks}`,
          "Knowledge Gap Category": rec.latestCategory || "Uncategorized",
          Progression: progressionDisplay,
          "Eventually Mastered": eventuallyMastered ? "Yes" : "No",
        };
      })
      .sort((a, b) => {
        // Prioritize not mastered, then times incorrect
        if (a["Eventually Mastered"] !== b["Eventually Mastered"]) {
          return a["Eventually Mastered"] === "No" ? -1 : 1;
        }
        return b["Times Incorrect"] - a["Times Incorrect"];
      });

    frequentlyMissedQuestions.push(...missedList);

    // -------------------------------------------------------------
    // BUILD AGENT SUMMARY ROW FOR THIS AGENT (Sheet 1)
    // -------------------------------------------------------------
    const testsAssigned = agentAssignedExams.length;
    const testsAttempted = agentAssignedExams.filter((e) =>
      agentAttempts.some((a) => a.examId === e.id)
    ).length;

    const testsCompleted = agentAssignedExams.filter((e) => {
      const p = agentExamPerfList.find((item) => item.exam.id === e.id);
      return p?.isCompleted;
    }).length;

    const completionRate =
      testsAssigned > 0 ? round((testsCompleted / testsAssigned) * 100) : 0;

    const totalAttempts = agentAttempts.length;

    // Reviewed attempts for score aggregations
    const allReviewedAttempts = agentAttempts.filter((a) => a.status === "reviewed");

    // Eligible reviewed exams for master score
    const eligibleReviewedExams = agentExamPerfList.filter(
      (p) => p.masterScorecard && p.masterScorecard.reviewedAttemptsCount > 0
    );

    const totalMarksEarned = eligibleReviewedExams.reduce(
      (sum, p) => sum + (p.masterScorecard.currentMasterScore ?? 0),
      0
    );

    const totalPossibleMarks = eligibleReviewedExams.reduce(
      (sum, p) => sum + (p.masterScorecard.masterTotalMarks ?? 0),
      0
    );

    const overallScore =
      totalPossibleMarks > 0 ? round((totalMarksEarned / totalPossibleMarks) * 100) : null;

    const masterPercentages = eligibleReviewedExams
      .map((p) => p.masterScorecard.masterPercentage)
      .filter((p): p is number => p !== null);

    const avgScore =
      masterPercentages.length > 0
        ? round(masterPercentages.reduce((s, p) => s + p, 0) / masterPercentages.length)
        : null;

    const highestScore =
      masterPercentages.length > 0 ? Math.max(...masterPercentages) : null;
    const lowestScore =
      masterPercentages.length > 0 ? Math.min(...masterPercentages) : null;

    // Total questions attempted & correct across reviewed attempts
    let questionsAttempted = 0;
    let correctAnswers = 0;
    allReviewedAttempts.forEach((a) => {
      a.answers.forEach((ans) => {
        questionsAttempted += 1;
        const maxMarks = ans.maxMarks || 10;
        const marks = ans.marks ?? 0;
        if (maxMarks > 0 && marks / maxMarks >= 0.7) {
          correctAnswers += 1;
        }
      });
    });

    // Average time across all attempts with valid time
    const allValidTimes = agentAttempts
      .map((a) => a.timeTakenSeconds)
      .filter((t): t is number => typeof t === "number" && t > 0);
    const avgTimeSecs =
      allValidTimes.length > 0
        ? Math.round(allValidTimes.reduce((s, t) => s + t, 0) / allValidTimes.length)
        : null;

    const strongestTopicStr = competency.strongestTopic
      ? `${competency.strongestTopic.topic} (${round(competency.strongestTopic.score)}%)`
      : "N/A";

    const weakestTopicStr = competency.weakestTopic
      ? `${competency.weakestTopic.topic} (${round(competency.weakestTopic.score)}%)`
      : "N/A";

    agentSummaries.push({
      "Agent Name": agentName,
      "Agent Email": agentEmail,
      "Overall Score (%)": safePercentageString(overallScore),
      "Tests Assigned": testsAssigned,
      "Tests Attempted": testsAttempted,
      "Tests Completed": testsCompleted,
      "Completion Rate (%)": `${completionRate}%`,
      "Total Attempts": totalAttempts,
      "Average Score (%)": safePercentageString(avgScore),
      "Highest Score (%)": safePercentageString(highestScore),
      "Lowest Score (%)": safePercentageString(lowestScore),
      "Questions Attempted": questionsAttempted,
      "Correct Answers": correctAnswers,
      "Marks Earned": totalMarksEarned,
      "Possible Marks": totalPossibleMarks,
      "Average Time": formatTimeTaken(avgTimeSecs),
      "Strongest Topic": strongestTopicStr,
      "Weakest Topic": weakestTopicStr,
    });
  });

  return {
    agentSummaries,
    examPerformances,
    frequentlyMissedQuestions,
    attemptHistories,
    filtersApplied: {
      agentCount: selectedAgents.length,
      examCount: selectedExams.length,
      startDate: filters?.startDate,
      endDate: filters?.endDate,
    },
    generatedAt: Date.now(),
  };
}

/* =========================================================
   EXCEL WORKBOOK EXPORT: 100% TEMPLATE FIDELITY
   Reproduces the exact sheet structure, headers, order,
   and layout of Team_Agent_Performance_Reports.xlsx
   ========================================================= */

export function exportReport2ToExcel(
  dataset: Report2Dataset,
  filename = "Team_Agent_Performance_Reports.xlsx"
) {
  const wb = XLSX.utils.book_new();

  // Helper to calculate sensible column widths
  const applyColWidths = (headers: string[], rows: Record<string, unknown>[]) => {
    return headers.map((header) => {
      let maxLen = header.length;
      for (const r of rows) {
        const val = r[header];
        if (val !== undefined && val !== null) {
          maxLen = Math.max(maxLen, String(val).length);
        }
      }
      return { wch: Math.min(Math.max(maxLen + 3, 12), 70) };
    });
  };

  // 1. Sheet: Agent Summary
  const agentSummaryHeaders = [
    "Agent Name",
    "Agent Email",
    "Overall Score (%)",
    "Tests Assigned",
    "Tests Attempted",
    "Tests Completed",
    "Completion Rate (%)",
    "Total Attempts",
    "Average Score (%)",
    "Highest Score (%)",
    "Lowest Score (%)",
    "Questions Attempted",
    "Correct Answers",
    "Marks Earned",
    "Possible Marks",
    "Average Time",
    "Strongest Topic",
    "Weakest Topic",
  ];
  const wsSummary = XLSX.utils.json_to_sheet(dataset.agentSummaries, {
    header: agentSummaryHeaders,
  });
  wsSummary["!cols"] = applyColWidths(agentSummaryHeaders, dataset.agentSummaries as unknown as Record<string, unknown>[]);
  XLSX.utils.book_append_sheet(wb, wsSummary, "Agent Summary");

  // 2. Sheet: Exam Performance
  const examPerformanceHeaders = [
    "Agent Name",
    "Agent Email",
    "Exam Name",
    "Category",
    "Mode",
    "Exam Status",
    "Is Archived",
    "Attempts Taken",
    "Master Score",
    "Master Total",
    "Master Progress (%)",
    "Latest Attempt Gain",
    "Questions Mastered",
    "Questions Remaining",
    "Latest Attempt Score (%)",
    "Best Attempt Score (%)",
    "Average Attempt Score (%)",
    "Average Time",
    "Review Status",
  ];
  const wsExam = XLSX.utils.json_to_sheet(dataset.examPerformances, {
    header: examPerformanceHeaders,
  });
  wsExam["!cols"] = applyColWidths(examPerformanceHeaders, dataset.examPerformances as unknown as Record<string, unknown>[]);
  XLSX.utils.book_append_sheet(wb, wsExam, "Exam Performance");

  // 3. Sheet: Frequently Missed Questions
  const missedHeaders = [
    "Agent Name",
    "Module",
    "Topic",
    "Question",
    "Type",
    "Times Attempted",
    "Times Incorrect",
    "Incorrect Rate (%)",
    "Latest Result",
    "Latest Score",
    "Knowledge Gap Category",
    "Progression",
    "Eventually Mastered",
  ];
  const wsMissed = XLSX.utils.json_to_sheet(dataset.frequentlyMissedQuestions, {
    header: missedHeaders,
  });
  wsMissed["!cols"] = applyColWidths(missedHeaders, dataset.frequentlyMissedQuestions as unknown as Record<string, unknown>[]);
  XLSX.utils.book_append_sheet(wb, wsMissed, "Frequently Missed Questions");

  // 4. Sheet: Attempt History
  const attemptHistoryHeaders = [
    "Agent Name",
    "Agent Email",
    "Exam Name",
    "Attempt Number",
    "Type",
    "Current Exam Score (%)",
    "Master Progress",
    "Progress Gain",
    "This Attempt Score",
    "Status",
    "Time",
    "Submitted At",
  ];
  const wsAttempts = XLSX.utils.json_to_sheet(dataset.attemptHistories, {
    header: attemptHistoryHeaders,
  });
  wsAttempts["!cols"] = applyColWidths(attemptHistoryHeaders, dataset.attemptHistories as unknown as Record<string, unknown>[]);
  XLSX.utils.book_append_sheet(wb, wsAttempts, "Attempt History");

  // 5. Sheet: Overall (Template specifies empty sheet preserving structure)
  const wsOverall = XLSX.utils.aoa_to_sheet([]);
  XLSX.utils.book_append_sheet(wb, wsOverall, "Overall");

  // Trigger browser download
  XLSX.writeFile(wb, filename);
}

/* =========================================================
   REPORT 2.0 PRINT / PDF EXPORT
   Proper paginated paper document with full wrapped question text.
   ========================================================= */

export function exportReport2ToPdf(
  dataset: Report2Dataset,
  filename = "Team_Agent_Performance_Report_2.0.pdf"
) {
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const PAGE_WIDTH = 210;
  const MARGIN_LEFT = 14;
  const MARGIN_RIGHT = 14;
  const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

  let y = 20;

  // Header Banner
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(185, 28, 50); // Brand red
  doc.text("QA EXAM PLATFORM · AUDITOR INTELLIGENCE", MARGIN_LEFT, y);

  y += 6;
  doc.setFontSize(18);
  doc.setTextColor(15, 23, 42); // Charcoal
  doc.text("Assessment Performance Report 2.0", MARGIN_LEFT, y);

  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  const dateStr = new Date(dataset.generatedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  doc.text(
    `Generated on ${dateStr} · Scope: ${dataset.filtersApplied.agentCount} Agents, ${dataset.filtersApplied.examCount} Exams`,
    MARGIN_LEFT,
    y
  );

  y += 4;
  doc.setDrawColor(185, 28, 50);
  doc.setLineWidth(0.6);
  doc.line(MARGIN_LEFT, y, MARGIN_LEFT + CONTENT_WIDTH, y);

  y += 6;

  // Section 1: Agent Summary Table
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("1. Agent Summary", MARGIN_LEFT, y);
  y += 2;

  const summaryTableHead = [
    ["Agent Name", "Overall Score", "Assigned", "Attempted", "Completed", "Attempts", "Average", "Earned / Possible"],
  ];
  const summaryTableBody = dataset.agentSummaries.map((s) => [
    s["Agent Name"],
    s["Overall Score (%)"],
    String(s["Tests Assigned"]),
    String(s["Tests Attempted"]),
    String(s["Tests Completed"]),
    String(s["Total Attempts"]),
    s["Average Score (%)"],
    `${s["Marks Earned"]} / ${s["Possible Marks"]}`,
  ]);

  autoTable(doc, {
    startY: y,
    head: summaryTableHead,
    body: summaryTableBody,
    theme: "striped",
    styles: {
      fontSize: 7.5,
      cellPadding: 2,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [185, 28, 50],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
  });

  // Section 2: Exam Performance
  doc.addPage();
  y = 20;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("2. Exam Performance Breakdown", MARGIN_LEFT, y);
  y += 2;

  const examTableHead = [
    ["Agent", "Exam Name", "Mode", "Attempts", "Master Score", "Progress", "Gain", "Review Status"],
  ];
  const examTableBody = dataset.examPerformances.map((e) => [
    e["Agent Name"],
    e["Exam Name"],
    e.Mode,
    String(e["Attempts Taken"]),
    `${e["Master Score"]} / ${e["Master Total"]}`,
    e["Master Progress (%)"],
    e["Latest Attempt Gain"],
    e["Review Status"],
  ]);

  autoTable(doc, {
    startY: y,
    head: examTableHead,
    body: examTableBody,
    theme: "striped",
    styles: {
      fontSize: 7,
      cellPadding: 2,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
  });

  // Section 3: Frequently Missed Questions (Full wrapped text, never clipped)
  if (dataset.frequentlyMissedQuestions.length > 0) {
    doc.addPage();
    y = 20;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text("3. Frequently Missed Questions", MARGIN_LEFT, y);
    y += 2;

    const missedTableHead = [
      ["Agent", "Module & Topic", "Question (Full Text)", "Attempted", "Incorrect", "Rate", "Score", "Mastered"],
    ];
    const missedTableBody = dataset.frequentlyMissedQuestions.map((q) => [
      q["Agent Name"],
      `${q.Module}\n${q.Topic}`,
      q.Question,
      String(q["Times Attempted"]),
      String(q["Times Incorrect"]),
      q["Incorrect Rate (%)"],
      q["Latest Score"],
      q["Eventually Mastered"],
    ]);

    autoTable(doc, {
      startY: y,
      head: missedTableHead,
      body: missedTableBody,
      theme: "striped",
      styles: {
        fontSize: 7,
        cellPadding: 2.5,
        overflow: "linebreak",
      },
      columnStyles: {
        2: { cellWidth: 70 }, // Wide column for full wrapped question text
      },
      headStyles: {
        fillColor: [185, 28, 50],
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
    });
  }

  // Section 4: Attempt Progression History
  if (dataset.attemptHistories.length > 0) {
    doc.addPage();
    y = 20;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text("4. Progressive Attempt History", MARGIN_LEFT, y);
    y += 2;

    const historyTableHead = [
      ["Agent", "Exam Name", "Attempt", "Type", "Master Progress", "Gain", "This Attempt", "Status", "Date"],
    ];
    const historyTableBody = dataset.attemptHistories.map((h) => [
      h["Agent Name"],
      h["Exam Name"],
      `#${h["Attempt Number"]}`,
      h.Type,
      h["Master Progress"],
      h["Progress Gain"],
      h["This Attempt Score"],
      h.Status,
      h["Submitted At"],
    ]);

    autoTable(doc, {
      startY: y,
      head: historyTableHead,
      body: historyTableBody,
      theme: "striped",
      styles: {
        fontSize: 7,
        cellPadding: 2,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [30, 41, 59],
        textColor: [255, 255, 255],
        fontStyle: "bold",
      },
      margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
    });
  }

  // Running page numbers in footer
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `QA Exam Platform · Report 2.0 · Page ${i} of ${totalPages}`,
      PAGE_WIDTH / 2,
      290,
      { align: "center" }
    );
  }

  doc.save(filename);
}
