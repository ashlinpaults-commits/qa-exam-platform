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
  // Used to detect duplicates across separate import runs.
  sourceId?: string;

  // Type-specific payloads
  options?: string[];
  correctOptionIndex?: number;
  imageUrl?: string;
  caseStudyContext?: string;
  orderItems?: string[];

  version: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;

  // Rolling analytics, denormalized for fast reads
  stats: {
    timesAsked: number;
    avgMarks: number;
    correctPct: number;
    incorrectPct: number;
  };
}

/* =========================================================
   EXAMS
   ========================================================= */

export type ExamMode = "normal" | "until_perfect";

export type ExamStatus =
  | "draft"
  | "published"
  | "active"
  | "completed"
  | "archived";

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

/* =========================================================
   PHASE 1 - KNOWLEDGE GAP TRACKING
   ========================================================= */

export type KnowledgeGapCategory =
  | "Product Knowledge"
  | "Workflow"
  | "Navigation"
  | "Troubleshooting"
  | "Insurance"
  | "Reporting"
  | "Clinical"
  | "Scheduler"
  | "Communication"
  | "Compliance"
  | "Other";

/* =========================================================
   ATTEMPT ANSWERS
   ========================================================= */

export interface ScoreHistoryEntry {
  marks: number;
  changedBy: string;
  reason: string;
  timestamp: number;
}

export interface AttemptAnswer {
  questionId: string;
  agentAnswer: string;

  // Filled by auditor
  marks?: number;

  maxMarks: number;
  comments?: string;

  // Phase 1 competency tracking
  knowledgeGapCategory?: KnowledgeGapCategory;

  // Audit trail for score changes
  scoreHistory?: ScoreHistoryEntry[];
}

/* =========================================================
   EXAM ATTEMPTS
   ========================================================= */

export type AttemptStatus =
  | "in_progress"
  | "submitted"
  | "review_in_progress"
  | "reviewed";

export interface ExamAttempt {
  id: string;
  examId: string;
  agentId: string;
  attemptNumber: number;

  answers: AttemptAnswer[];

  /* -------------------------
     Agent attempt lifecycle
     ------------------------- */

  startedAt: number;
  submittedAt?: number;
  timeTakenSeconds?: number;

  /* -------------------------
     Scoring
     ------------------------- */

  totalMarks?: number;
  maxTotalMarks?: number;

  /* -------------------------
     Attempt state
     ------------------------- */

  status: AttemptStatus;

  /* -------------------------
     Auditor review lifecycle
     ------------------------- */

  // Set when auditor first saves/starts the review
  reviewStartedAt?: number;

  // Auditor who reviewed/scored the attempt
  reviewedBy?: string;

  // Set when the final review is submitted
  reviewedAt?: number;

  /* -------------------------
     Analytics protection
     ------------------------- */

  // Prevents finalized analytics from being counted
  // more than once for the same attempt.
  analyticsFinalized?: boolean;
}