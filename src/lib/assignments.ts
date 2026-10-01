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
  attemptNumber?: number;
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
    attemptNumber,
  } = params;

  if (!questionIds || questionIds.length === 0) {
    throw new Error("Cannot create an assignment with zero questions.");
  }

  const modeKey = reassignmentMode || "all";
  const baseAssignmentId = generateAssignmentId(exam.id, agentId, modeKey, sourceAttemptId);
  let targetAssignmentId = baseAssignmentId;

  let resultAssignment: ExamAssignment | null = null;

  await runTransaction(db, async (transaction) => {
    const existingSnap = await transaction.get(doc(db, COL, baseAssignmentId));

    if (existingSnap.exists()) {
      const existingData = existingSnap.data() as ExamAssignment;
      // If assignment is still active/actionable, reuse it (idempotent result for double clicks)
      if (existingData.status === "assigned" || existingData.status === "in_progress") {
        console.debug(`[createAssignment] Reusing existing active assignment ${baseAssignmentId}`);
        resultAssignment = { ...existingData, id: existingSnap.id };
        return;
      }
      // If previously revoked or submitted, generate a unique sequential ID to preserve history
      if (existingData.status === "revoked" || existingData.status === "submitted" || existingData.status === "reviewed") {
        targetAssignmentId = `${baseAssignmentId}_${Date.now()}`;
      }
    }

    const assignmentRef = doc(db, COL, targetAssignmentId);
    const payload: ExamAssignment = stripUndefined({
      id: targetAssignmentId,
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
      attemptNumber,
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
 * Fetches currently active assignments for an agent (assigned or in_progress, excluding revoked).
 */
export async function fetchActiveAssignmentsForAgent(
  agentId: string
): Promise<ExamAssignment[]> {
  const all = await fetchAssignmentsForAgent(agentId);
  return all.filter((a) => a.status === "assigned" || a.status === "in_progress");
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
 * Fetches currently active assignments for an exam (assigned or in_progress).
 */
export async function fetchActiveAssignmentsForExam(
  examId: string
): Promise<ExamAssignment[]> {
  const all = await fetchAssignmentsForExam(examId);
  return all.filter((a) => a.status === "assigned" || a.status === "in_progress");
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
 * Revokes an assignment with authoritative state persistence and access termination.
 * 
 * Guarantees:
 * 1. Preserves completed historical attempts, scores, and master progress.
 * 2. If assignment is unstarted: marks assignment revoked and removes agent from exam.assignedAgentIds (if no attempts).
 * 3. If assignment has an in-progress attempt: terminates attempt with status "revoked" and prevents agent from continuing.
 * 4. Clears reattempt permissions on the exam.
 * 5. Idempotent: repeated calls safely succeed with no corruption.
 */
export async function revokeAssignment(params: {
  examId: string;
  agentId: string;
  assignmentId?: string;
  revokedBy: string;
  reason?: string;
}): Promise<{ revokedAssignmentId: string; attemptTerminated: boolean }> {
  const { examId, agentId, assignmentId, revokedBy, reason } = params;
  const now = Date.now();
  const revocationReason = reason?.trim() || "Assignment revoked by auditor";

  let targetAssignment: ExamAssignment | null = null;

  // 1. Locate specific assignment or active assignment for agent + exam
  if (assignmentId) {
    targetAssignment = await getAssignment(assignmentId);
  }

  if (!targetAssignment) {
    const activeList = await fetchActiveAssignmentsForAgent(agentId);
    targetAssignment = activeList.find((a) => a.examId === examId) || null;
  }

  let attemptTerminated = false;
  let revokedAssignmentId = targetAssignment?.id || "";

  // 2. Mark assignment document as revoked inside transaction
  if (targetAssignment) {
    revokedAssignmentId = targetAssignment.id;
    const assignmentRef = doc(db, COL, targetAssignment.id);

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(assignmentRef);
      if (!snap.exists()) return;
      const current = snap.data() as ExamAssignment;
      if (current.status === "revoked") {
        // Idempotent: already revoked
        return;
      }

      transaction.update(
        assignmentRef,
        stripUndefined({
          status: "revoked",
          revokedAt: now,
          revokedBy,
          revocationReason,
        })
      );
    });

    // If an attempt was started from this assignment and is currently in_progress, terminate it
    if (targetAssignment.attemptId) {
      const attemptRef = doc(db, "attempts", targetAssignment.attemptId);
      try {
        await runTransaction(db, async (transaction) => {
          const aSnap = await transaction.get(attemptRef);
          if (aSnap.exists()) {
            const aData = aSnap.data() as ExamAttempt;
            if (aData.status === "in_progress") {
              transaction.update(attemptRef, { status: "revoked" });
              attemptTerminated = true;
            }
          }
        });
      } catch (err) {
        console.warn("[revokeAssignment] Could not update linked attempt status:", err);
      }
    }
  } else {
    // If no explicit assignments document existed (e.g. legacy standard assignment), persist a revoked record
    revokedAssignmentId = `${examId}_${agentId}_revoked_${now}`;
    const syntheticRef = doc(db, COL, revokedAssignmentId);
    await runTransaction(db, async (transaction) => {
      transaction.set(
        syntheticRef,
        stripUndefined({
          id: revokedAssignmentId,
          examId,
          agentId,
          assignmentType: "original",
          questionIds: [],
          status: "revoked",
          assignedAt: now,
          revokedAt: now,
          revokedBy,
          revocationReason,
        })
      );
    });
  }

  // 3. Check for any in-progress attempt for this agent & exam in the attempts collection
  try {
    const qAttempts = query(
      collection(db, "attempts"),
      where("examId", "==", examId),
      where("agentId", "==", agentId),
      where("status", "==", "in_progress")
    );
    const inProgressSnaps = await getDocs(qAttempts);
    for (const d of inProgressSnaps.docs) {
      await updateDoc(doc(db, "attempts", d.id), { status: "revoked" });
      attemptTerminated = true;
    }
  } catch (err) {
    console.warn("[revokeAssignment] Query for in-progress attempts failed:", err);
  }

  // 4. Update the exam: remove reattempt permissions and check completed attempts
  try {
    const examSnap = await getDoc(doc(db, "exams", examId));
    if (examSnap.exists()) {
      const examData = examSnap.data() as Exam;
      const reattemptPermissions = { ...(examData.reattemptPermissions || {}) };
      delete reattemptPermissions[agentId];

      // Check if the agent has any completed (reviewed) historical attempts
      const qCompleted = query(
        collection(db, "attempts"),
        where("examId", "==", examId),
        where("agentId", "==", agentId),
        where("status", "==", "reviewed")
      );
      const completedSnaps = await getDocs(qCompleted);
      const hasCompletedAttempts = !completedSnaps.empty;

      const patch: Partial<Exam> = { reattemptPermissions };

      // If no completed attempts exist, safely remove agent from assignedAgentIds
      if (!hasCompletedAttempts && Array.isArray(examData.assignedAgentIds)) {
        patch.assignedAgentIds = examData.assignedAgentIds.filter((id) => id !== agentId);
      }

      await updateExam(examId, patch);
    }
  } catch (err) {
    console.warn("[revokeAssignment] Failed to update exam metadata:", err);
  }

  return { revokedAssignmentId, attemptTerminated };
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
  targetAttemptNumber?: number;
}): Promise<ExamAssignment> {
  const { exam, agentId, sourceAttempt, mode, customQuestionIds, assignedBy, targetAttemptNumber } = params;

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

  const nextAttemptNumber = targetAttemptNumber || (sourceAttempt.attemptNumber ? sourceAttempt.attemptNumber + 1 : 2);

  return createAssignment({
    exam,
    agentId,
    sourceAttemptId: sourceAttempt.id,
    assignmentType: "reassigned",
    reassignmentMode: mode,
    questionIds: targetQuestionIds,
    assignedBy,
    attemptNumber: nextAttemptNumber,
  });
}
