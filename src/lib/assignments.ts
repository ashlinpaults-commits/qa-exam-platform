import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  runTransaction,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import { updateExam } from "./exams";
import type {
  Exam,
  ExamAttempt,
  ExamAssignment,
  AssignmentType,
  ReassignmentMode,
  AssignmentStatus,
} from "@/types";
import { stripUndefined } from "./questions";

const COL = "assignments";

/**
 * Generates a deterministic assignment ID to guarantee idempotency.
 * Two identical clicks or requests will target the exact same document ID.
 */
export function generateAssignmentId(
  examId: string,
  agentId: string,
  mode: string,
  sourceAttemptId?: string
): string {
  if (sourceAttemptId) {
    // Deterministic per source attempt and reassignment mode
    return `${examId}_${agentId}_reassign_${sourceAttemptId}_${mode}`;
  }
  return `${examId}_${agentId}_orig`;
}

/**
 * Creates an assignment record with idempotency and duplicate protection.
 */
export async function createAssignment(params: {
  exam: Exam;
  agentId: string;
  sourceAttemptId?: string;
  assignmentType: AssignmentType;
  reassignmentMode?: ReassignmentMode;
  questionIds: string[];
  assignedBy: string;
  dueAt?: number;
}): Promise<ExamAssignment> {
  const {
    exam,
    agentId,
    sourceAttemptId,
    assignmentType,
    reassignmentMode,
    questionIds,
    assignedBy,
    dueAt,
  } = params;

  if (!questionIds || questionIds.length === 0) {
    throw new Error("Cannot create an assignment with zero questions.");
  }

  const modeKey = reassignmentMode || "all";
  const assignmentId = generateAssignmentId(exam.id, agentId, modeKey, sourceAttemptId);
  const assignmentRef = doc(db, COL, assignmentId);

  let resultAssignment: ExamAssignment | null = null;

  await runTransaction(db, async (transaction) => {
    const existingSnap = await transaction.get(assignmentRef);

    if (existingSnap.exists()) {
      const existingData = existingSnap.data() as ExamAssignment;
      // If assignment is still active/actionable, reuse it (idempotent result)
      if (existingData.status === "assigned" || existingData.status === "in_progress") {
        console.debug(`[createAssignment] Reusing existing active assignment ${assignmentId}`);
        resultAssignment = { ...existingData, id: existingSnap.id };
        return;
      }
    }

    const payload: ExamAssignment = stripUndefined({
      id: assignmentId,
      examId: exam.id,
      agentId,
      sourceAttemptId,
      assignmentType,
      reassignmentMode,
      questionIds,
      status: "assigned",
      assignedAt: Date.now(),
      assignedBy,
      dueAt,
      examName: exam.name || "Exam",
      module: exam.module,
      batch: exam.batch,
      questionCount: questionIds.length,
    });

    transaction.set(assignmentRef, payload);
    resultAssignment = payload;
  });

  // Ensure agent is in assignedAgentIds for security rules and exam listing
  const assignedAgentIds = new Set(exam.assignedAgentIds || []);
  if (!assignedAgentIds.has(agentId)) {
    assignedAgentIds.add(agentId);
    await updateExam(exam.id, {
      assignedAgentIds: Array.from(assignedAgentIds),
      status: exam.status === "draft" ? "published" : exam.status,
    });
  }

  // Also maintain backward-compatible reattemptPermissions if reassigned
  if (assignmentType === "reassigned") {
    const permissions = {
      ...(exam.reattemptPermissions || {}),
      [agentId]: {
        agentId,
        mode: reassignmentMode === "wrong_only"
          ? ("wrong_answers" as const)
          : reassignmentMode === "custom"
          ? ("select_questions" as const)
          : ("same_questions" as const),
        questionIds,
        grantedAt: Date.now(),
        grantedBy: assignedBy,
      },
    };

    await updateExam(exam.id, {
      reattemptPermissions: permissions,
    });
  }

  if (!resultAssignment) {
    throw new Error("Failed to create assignment.");
  }

  return resultAssignment;
}

/**
 * Fetches all assignments for a specific agent.
 */
export async function fetchAssignmentsForAgent(
  agentId: string,
  status?: AssignmentStatus
): Promise<ExamAssignment[]> {
  const clauses = status
    ? [where("agentId", "==", agentId), where("status", "==", status)]
    : [where("agentId", "==", agentId)];

  let snap;
  try {
    const q = query(collection(db, COL), ...clauses, orderBy("assignedAt", "desc"));
    snap = await getDocs(q);
  } catch (err) {
    console.warn("[fetchAssignmentsForAgent] Query with orderBy failed, falling back to in-memory sort:", err);
    const q = query(collection(db, COL), ...clauses);
    snap = await getDocs(q);
  }

  const list = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<ExamAssignment, "id">),
  }));

  return list.sort((a, b) => (b.assignedAt || 0) - (a.assignedAt || 0));
}

/**
 * Fetches all assignments for an exam.
 */
export async function fetchAssignmentsForExam(
  examId: string
): Promise<ExamAssignment[]> {
  let snap;
  try {
    const q = query(
      collection(db, COL),
      where("examId", "==", examId),
      orderBy("assignedAt", "desc")
    );
    snap = await getDocs(q);
  } catch (err) {
    console.warn("[fetchAssignmentsForExam] Query with orderBy failed, falling back to in-memory sort:", err);
    const q = query(collection(db, COL), where("examId", "==", examId));
    snap = await getDocs(q);
  }

  const list = snap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<ExamAssignment, "id">),
  }));

  return list.sort((a, b) => (b.assignedAt || 0) - (a.assignedAt || 0));
}

/**
 * Gets a single assignment by ID.
 */
export async function getAssignment(
  assignmentId: string
): Promise<ExamAssignment | null> {
  const snap = await getDoc(doc(db, COL, assignmentId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as ExamAssignment) : null;
}

/**
 * Updates status of an assignment and optionally records attemptId.
 */
export async function updateAssignmentStatus(
  assignmentId: string,
  status: AssignmentStatus,
  attemptId?: string
): Promise<void> {
  const ref = doc(db, COL, assignmentId);
  const patch: Partial<ExamAssignment> = { status };
  if (attemptId) {
    patch.attemptId = attemptId;
  }
  await updateDoc(ref, stripUndefined(patch));
}

/**
 * Helper to reassign an exam based on a completed attempt.
 * Validates question sets and prevents empty assignments.
 */
export async function reassignExamFromAttempt(params: {
  exam: Exam;
  agentId: string;
  sourceAttempt: ExamAttempt;
  mode: ReassignmentMode;
  customQuestionIds?: string[];
  assignedBy: string;
}): Promise<ExamAssignment> {
  const { exam, agentId, sourceAttempt, mode, customQuestionIds, assignedBy } = params;

  let targetQuestionIds: string[] = [];

  if (mode === "all") {
    targetQuestionIds = (exam.questions || []).map((q) => q.questionId);
    if (targetQuestionIds.length === 0) {
      throw new Error("The original exam has no questions to reassign.");
    }
  } else if (mode === "wrong_only") {
    // Find all questions where marks were lost (marks < maxMarks or undefined)
    const missed = (sourceAttempt.answers || []).filter(
      (a) => a.marks === undefined || a.marks < a.maxMarks
    );

    if (missed.length === 0) {
      throw new Error("Agent scored 100% on all questions. There are no incorrect questions to reassign.");
    }

    targetQuestionIds = missed.map((a) => a.questionId);
  } else if (mode === "custom") {
    if (!customQuestionIds || customQuestionIds.length === 0) {
      throw new Error("Please select at least one question for custom reassignment.");
    }
    targetQuestionIds = customQuestionIds;
  }

  return createAssignment({
    exam,
    agentId,
    sourceAttemptId: sourceAttempt.id,
    assignmentType: "reassigned",
    reassignmentMode: mode,
    questionIds: targetQuestionIds,
    assignedBy,
  });
}
