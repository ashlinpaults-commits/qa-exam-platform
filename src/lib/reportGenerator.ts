import type {
  ReportData,
  TraineePerformance,
  BatchSummary,
} from "@/types/report";

import type {
  AppUser,
  Exam,
  ExamAttempt,
} from "@/types";

export function generateReport(
  exam: Exam,
  attempts: ExamAttempt[],
  users: AppUser[]
): ReportData {

  // Build trainee performance

  const trainees: TraineePerformance[] = [];

  // Build batch summary

  const batchSummary: BatchSummary = {
    totalAgents: 0,
    completed: 0,
    averageScore: 0,
    highestScore: 0,
    lowestScore: 0,
  };

  return {
    examTitle: exam.name,
    createdDate: new Date().toLocaleDateString(),

    batchSummary,

    trainees,

    modules: [],

    questions: [],

    aiSummary: "",

    trainerNotes: "",
  };
}