export type UserRole = "auditor" | "agent";

export interface AppUser {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  photoURL?: string;
  streamId?: string;
  batch?: string;
  assignedTrainerId?: string;
  isActive?: boolean;
  status?: "active" | "inactive";
  createdAt: number;
  updatedAt?: number;
  lastLoginAt?: number;
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
  topic?: string;
  difficulty: Difficulty;
  tags: string[];
  type: QuestionType;
  questionText: string;
  expectedAnswer: string;
  notes?: string;

  // "<module>::<Question No.>" from the source spreadsheet, when available.
  // Used to detect duplicates across separate import runs.
  sourceId?: string;

  // Preserves pre-migration classification for auditability and full rollback
  legacyClassification?: {
    module?: string;
    feature?: string;
    migratedAt?: number;
  };

  // Normalized substantive content fingerprint for cross-exam deduplication
  fingerprint?: string;

  // Type-specific payloads
  options?: string[];
  correctOptionIndex?: number;
  imageUrl?: string;
  caseStudyContext?: string;
  orderItems?: string[];
  shuffledOrderItems?: string[];

  version: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;

  // Rolling analytics, denormalized for fast reads
  stats?: {
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
  category?: "Revenue Cycle Management" | "Patient Engagement";
  examDate?: string;
  mode: ExamMode;
  assessmentMode?: AssessmentMode;
  status: ExamStatus;
  questions: ExamQuestionRef[];
  // Safe projection used by agents. Never put expectedAnswer or grading keys
  // in this field; agents must not read the question bank directly.
  questionSnapshots?: Record<string, Question>;
  assignedAgentIds: string[];
  // Reattempt authorizations granted by auditors per agent
  reattemptPermissions?: Record<string, ReattemptPermission>;
  batchId?: string;
  batch?: string;
  module?: string;
  assessmentType?: string;
  testNumber?: number;
  moduleScope?: string[];
  timeLimitMinutes?: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface ReattemptPermission {
  agentId: string;
  mode: "same_questions" | "wrong_answers" | "select_questions";
  questionIds?: string[];
  grantedAt: number;
  grantedBy: string;
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
  | "user_role_changed"
  | "user_created"
  | "user_updated"
  | "user_deactivated"
  | "user_reactivated"
  | "settings_updated"
  | "SETTINGS_UPDATED"
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_DEACTIVATED"
  | "USER_REACTIVATED"
  | "USER_ROLE_CHANGED";

export type AuditActionType = AuditAction;

export interface AuditLogEntry {
  id?: string;
  action: AuditAction;
  actorId: string;
  actorEmail?: string;
  actorName?: string;
  targetId?: string;
  targetName?: string;
  entityType?: "stream" | "batch" | "exam" | "attempt" | "report" | "user" | "settings";
  entityId?: string;
  summary?: string;
  details?: Record<string, unknown>;
  metadata?: Record<string, string | number | boolean | null>;
  timestamp?: number;
  createdAt?: number;
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
  previousMarks?: number;
  previousScore?: number;
  aiSuggestedScore?: number;
}

export interface AttemptAnswer {
  questionId: string;
  agentAnswer: string;

  // Filled by auditor
  marks?: number;

  // Preserved original finalized score before amendments
  originalFinalScore?: number;

  // AI suggested score preserved separately from auditor score
  aiSuggestedScore?: number;

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
   AI REVIEW TYPES
   ========================================================= */

export type AiConfidence = "high" | "medium" | "low";
export type AiReviewStatus = "pending" | "processing" | "complete" | "failed";

export type AiVerdict =
  | "fully_correct"
  | "mostly_correct"
  | "partially_correct"
  | "mostly_incorrect"
  | "incorrect"
  | "no_answer";

export interface QuestionAiReview {
  questionId: string;
  understandingScore?: number; // 0 to 10 understanding scale
  aiSuggestedScore: number; // Converted to question maxMarks
  maxScore: number;
  confidence: AiConfidence;
  verdict?: AiVerdict;
  reasoning: string;
  matchedConcepts?: string[];
  missingConcepts?: string[];
  contradictions?: string[];
  missingPoints?: string[];
  detectedIssues?: string[];
  reviewedAt: number;
}

export interface AttemptAiReview {
  status: AiReviewStatus;
  reviewedAt?: number;
  overallSuggestedScore?: number;
  maxPossibleScore?: number;
  overallSuggestedPercentage?: number;
  questionReviews: QuestionAiReview[];
  errorMessage?: string;
  error?: string;
}

/* =========================================================
   EXAM ASSIGNMENTS
   ========================================================= */

export type AssignmentType = "original" | "reassigned";
export type ReassignmentMode = "all" | "wrong_only" | "custom";
export type AssignmentStatus = "assigned" | "in_progress" | "submitted" | "reviewed" | "revoked" | "cancelled";

export interface ExamAssignment {
  id: string;
  examId: string;
  agentId: string;
  sourceAttemptId?: string;
  assignmentType: AssignmentType;
  reassignmentMode?: ReassignmentMode;
  questionIds: string[];
  status: AssignmentStatus;
  assignedAt: number;
  assignedBy?: string;
  dueAt?: number;
  attemptId?: string;
  attemptNumber?: number;
  examName?: string;
  module?: string;
  batch?: string;
  questionCount?: number;

  // Revocation metadata
  revokedAt?: number;
  revokedBy?: string;
  revocationReason?: string;

  // Cancellation metadata
  cancelledAt?: number;
  cancelledBy?: string;
  cancellationReason?: string;
}

/* =========================================================
   EXAM ATTEMPTS
   ========================================================= */

export type AttemptStatus =
  | "in_progress"
  | "submitted"
  | "review_in_progress"
  | "reviewed"
  | "revoked";

export interface ExamAttempt {
  id: string;
  examId: string;
  agentId: string;
  attemptNumber: number;

  // Optional link to specific assignment
  assignmentId?: string;

  // Reattempt identification
  isReattempt?: boolean;
  parentAttemptId?: string;
  reattemptSource?: "same_questions" | "wrong_answers" | "manual_selection";

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
  originalTotalMarks?: number;
  amendedAt?: number;
  amendedBy?: string;
  amendmentReason?: string;

  /* -------------------------
     Attempt state
     ------------------------- */

  status: AttemptStatus;

  /* -------------------------
     AI Review
     ------------------------- */

  aiReview?: AttemptAiReview;
  hasAiReview?: boolean;
  aiReviewStatus?: AiReviewStatus;

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

/* =========================================================
   PROGRESSIVE MASTER SCORING MODEL
   ========================================================= */

export interface QuestionMasteryRecord {
  questionId: string;
  questionText: string;
  module: string;
  feature: string;
  topic?: string;
  maxMarks: number;
  bestMarks: number;
  isMastered: boolean;
  timesAttempted: number;
  timesIncorrect: number;
  progression: ("correct" | "improvement" | "incorrect")[];
  latestAttemptNumber: number;
  sourceAttemptNumber?: number;
  latestMarks?: number;
  knowledgeGapCategory?: KnowledgeGapCategory;
}

export interface AttemptProgressionStep {
  attemptId: string;
  attemptNumber: number;
  isReattempt: boolean;
  status: ExamAttempt["status"];
  submittedAt?: number;
  reviewedAt?: number;
  timeTakenSeconds?: number;

  // Attempt score in isolation (raw attempt performance)
  attemptMarks: number;
  attemptMaxMarks: number;
  attemptPercentage: number;
  attemptScore?: number; // Alias for attemptPercentage
  rawAttemptMarks?: number;
  rawAttemptMaxMarks?: number;
  rawAttemptPercentage?: number;

  // Master cumulative progression
  cumulativeMasterScore: number;
  masterTotalMarks: number;
  cumulativePercentage: number;
  progressGain: number;
  questionsMasteredSoFar: number;
  questionsRemaining: number;
}

export interface ExamMasterScorecard {
  examId: string;
  agentId: string;
  examName: string;
  masterTotalMarks: number;
  currentMasterScore: number;
  masterPercentage: number;
  totalQuestions: number;
  questionsMastered: number;
  questionsRemaining: number;
  attemptsCount: number;
  reviewedAttemptsCount: number;
  latestAttemptNumber: number;
  isCompleted: boolean;
  latestAttemptGain: number;
  progression: AttemptProgressionStep[];
  questionMastery: QuestionMasteryRecord[];
}

/* =========================================================
   APPLICATION SETTINGS & AUDIT LOGS
   ========================================================= */

export interface AppSettings {
  // General Settings
  appName: string;
  supportContactEmail?: string;

  // Exam Defaults
  defaultExamDuration: number; // In minutes: 1 - 600
  defaultPassingScore: number; // In percentage: 0 - 100
  allowAgentReattempts: boolean;
  defaultReassignmentMode: "full_exam" | "incorrect_only";

  // Notifications
  enableEmailNotifications: boolean;
  notificationEmail?: string;

  // Reports
  defaultReportWindowDays: number; // 1 - 365
  requireAmendmentReason: boolean;

  // System & Maintenance
  maintenanceMode: boolean;
  maintenanceMessage?: string;

  // Audit metadata
  updatedAt?: number;
  updatedBy?: string;
  updatedByName?: string;
}

