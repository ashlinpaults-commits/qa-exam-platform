export interface BatchSummary {
  totalAgents: number;
  completed: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
}

export interface TraineePerformance {
  agentId: string;
  agentName: string;
  score: number;
  percentage: number;
  status: "Passed" | "Needs Coaching" | "Pending";
}

export interface ModulePerformance {
  module: string;
  averageScore: number;
  questions: number;
}

export interface QuestionPerformance {
  questionId: string;
  question: string;
  correct: number;
  incorrect: number;
}

export interface ReportData {
  examTitle: string;
  createdDate: string;

  batchSummary: BatchSummary;

  trainees: TraineePerformance[];

  modules: ModulePerformance[];

  questions: QuestionPerformance[];

  aiSummary?: string;

  trainerNotes?: string;
}
