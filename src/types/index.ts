export type UserRole = "auditor" | "agent";

export interface AppUser {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  photoURL?: string;
  createdAt: number;
}

export type QuestionType =
  | "descriptive"
  | "mcq"
  | "true_false"
  | "image_based"
  | "case_study"
  | "drag_drop_order";

export type Difficulty = "easy" | "medium" | "hard";

export interface Question {
  id: string;
  module: string;
  feature: string;
  difficulty: Difficulty;
  tags: string[];
  type: QuestionType;
  questionText: string;
  expectedAnswer: string;
  notes?: string;
  // "<module>::<Question No.>" from the source spreadsheet, when available.
  // Used to detect duplicates across separate import runs (e.g. retrying a
  // partially-failed import shouldn't create a second copy of every row that
  // already succeeded).
  sourceId?: string;
  // type-specific payloads
  options?: string[]; // mcq
  correctOptionIndex?: number; // mcq
  imageUrl?: string; // image_based
  caseStudyContext?: string; // case_study (ticket transcript etc.)
  orderItems?: string[]; // drag_drop_order (correct order)
  version: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  // rolling analytics, denormalized for fast reads
  stats: {
    timesAsked: number;
    avgMarks: number;
    correctPct: number;
    incorrectPct: number;
  };
}

export type ExamMode = "normal" | "until_perfect";
export type ExamStatus = "draft" | "published" | "active" | "completed" | "archived";

export interface ExamQuestionRef {
  questionId: string;
  order: number;
}

export interface Exam {
  id: string;
  name: string;
  description: string;
  mode: ExamMode;
  status: ExamStatus;
  questions: ExamQuestionRef[];
  assignedAgentIds: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface AttemptAnswer {
  questionId: string;
  agentAnswer: string;
  marks?: number; // filled by auditor
  maxMarks: number;
  comments?: string;
  scoreHistory?: {
    marks: number;
    changedBy: string;
    reason: string;
    timestamp: number;
  }[];
}

export interface ExamAttempt {
  id: string;
  examId: string;
  agentId: string;
  attemptNumber: number;
  answers: AttemptAnswer[];
  startedAt: number;
  submittedAt?: number;
  timeTakenSeconds?: number;
  totalMarks?: number;
  maxTotalMarks?: number;
  status: "in_progress" | "submitted" | "reviewed";
  reviewedBy?: string;
  reviewedAt?: number;
}
