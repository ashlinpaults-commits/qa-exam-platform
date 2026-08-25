export type UserRole = "auditor" | "agent";

export interface AppUser {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  photoURL?: string;
  streamId?: string;
  assignedTrainerId?: string;
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

export type AssessmentMode =
  | "daily"
  | "random"
  | "weak_area"
  | "until_perfect"
  | "final_certification"
  | "speed";

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
  assessmentMode?: AssessmentMode;
  status: ExamStatus;
  questions: ExamQuestionRef[];
  // Safe projection used by agents. Never put expectedAnswer or grading keys
  // in this field; agents must not read the question bank directly.
  questionSnapshots?: Record<string, Question>;
  assignedAgentIds: string[];
  batchId?: string;
  moduleScope?: string[];
  timeLimitMinutes?: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

/* =========================================================
   TRAINING MANAGEMENT
   ========================================================= */

export interface TrainingStream {
  id: string;
  name: string;
  description: string;
  modules: string[];
  active: boolean;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface TrainingScheduleItem {
  id: string;
  date: string;
  module: string;
  durationHours: number;
  completed: boolean;
  notes?: string;
}

export type BatchStatus =
  | "planned"
  | "active"
  | "completed"
  | "archived";

export interface TrainingBatch {
  id: string;
  name: string;
  trainerId: string;
  streamId: string;
  startDate: string;
  endDate: string;
  traineeIds: string[];
  schedule: TrainingScheduleItem[];
  status: BatchStatus;
  reportRecipientEmails: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export type ReportType =
  | "daily"
  | "weekly"
  | "manager_summary"
  | "batch";

export interface ReportSchedule {
  id: string;
  batchId: string;
  type: ReportType;
  recipientEmails: string[];
  enabled: boolean;
  hourLocal: number;
  timezone: string;
  lastQueuedAt?: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export type NotificationType =
  | "report_queued"
  | "coaching_queue_changed"
  | "exam_completed"
  | "threshold_hit";

export interface SmartNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  audienceUserIds: string[];
  entityType?: "batch" | "exam" | "agent" | "report";
  entityId?: string;
  readBy: string[];
  createdAt: number;
}

export type AuditAction =
  | "stream_created"
  | "stream_updated"
  | "stream_deleted"
  | "batch_created"
  | "batch_updated"
  | "batch_deleted"
  | "exam_created"
  | "exam_updated"
  | "exam_assigned"
  | "attempt_submitted"
  | "review_saved"
  | "review_finalized"
  | "report_viewed"
  | "report_queued"
  | "user_role_changed";

export interface AuditLogEntry {
  id: string;
  action: AuditAction;
  actorId: string;
  entityType: "stream" | "batch" | "exam" | "attempt" | "report" | "user";
  entityId: string;
  summary: string;
  metadata?: Record<string, string | number | boolean | null>;
  createdAt: number;
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

  // Full copy of the Question Bank question as it existed when this
  // attempt was created. Historical attempts must always show what the
  // agent actually saw/answered, even if the Question Bank entry is later
  // edited or deleted. Optional so attempts created before this field
  // existed remain representable; new attempts use the safe snapshot
  // published on the exam.
  questionSnapshot?: Question;
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

  // Agent-owned draft answers. Kept separate from the auditor-owned `answers`
  // array so Firestore rules can permit autosave without permitting score
  // mutations inside a client-supplied array.
  agentAnswers?: Record<string, string>;

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
