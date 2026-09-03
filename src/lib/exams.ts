import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, getDoc, query,
  where, orderBy,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Exam, ExamStatus, ExamQuestionRef, Question } from "@/types";
import { stripUndefined, getQuestionsByIds, createRedactedQuestionSnapshot } from "./questions";

const COL = "exams";

function normalizeExamDoc(id: string, raw: Partial<Exam>): Exam {
  return {
    id,
    name: raw.name || "Untitled Exam",
    description: raw.description || "",
    category: raw.category,
    examDate: raw.examDate,
    mode: raw.mode || "normal",
    assessmentMode: raw.assessmentMode,
    status: raw.status || "draft",
    questions: raw.questions || [],
    questionSnapshots: raw.questionSnapshots || {},
    assignedAgentIds: raw.assignedAgentIds || [],
    reattemptPermissions: raw.reattemptPermissions || {},
    batchId: raw.batchId,
    moduleScope: raw.moduleScope,
    timeLimitMinutes: raw.timeLimitMinutes,
    createdBy: raw.createdBy || "",
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
  };
}

export async function fetchExams(status?: ExamStatus): Promise<Exam[]> {
  const q = status
    ? query(collection(db, COL), where("status", "==", status), orderBy("updatedAt", "desc"))
    : query(collection(db, COL), orderBy("updatedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => normalizeExamDoc(d.id, d.data() as Partial<Exam>));
}

export async function fetchAssignedExams(agentId: string): Promise<Exam[]> {
  const q = query(
    collection(db, COL),
    where("assignedAgentIds", "array-contains", agentId),
    where("status", "in", ["published", "active"])
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => normalizeExamDoc(d.id, d.data() as Partial<Exam>));
}

export async function getExam(id: string): Promise<Exam | null> {
  const snap = await getDoc(doc(db, COL, id));
  return snap.exists() ? normalizeExamDoc(snap.id, snap.data() as Partial<Exam>) : null;
}

export async function createExam(
  data: Omit<Exam, "id" | "createdAt" | "updatedAt" | "createdBy">,
  createdBy: string
) {
  const payload = stripUndefined({
    ...data,
    createdBy,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const ref = await addDoc(collection(db, COL), payload);
  return ref.id;
}

export async function updateExam(id: string, data: Partial<Exam>) {
  const payload = stripUndefined({ ...data, updatedAt: Date.now() });
  await updateDoc(doc(db, COL, id), payload);
}

export async function deleteExam(id: string) {
  await deleteDoc(doc(db, COL, id));
}

export async function duplicateExam(examId: string, createdBy: string): Promise<Exam> {
  const original = await getExam(examId);
  if (!original) throw new Error("Exam not found");
  const { id: _drop, ...rest } = original;
  const payload = stripUndefined({
    ...rest,
    name: `${original.name} (Copy)`,
    status: "draft" as const,
    assignedAgentIds: [],
    reattemptPermissions: {},
    createdBy,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  const ref = await addDoc(collection(db, COL), payload);
  return { id: ref.id, ...payload };
}

export function reorderQuestions(refs: ExamQuestionRef[], fromIndex: number, toIndex: number): ExamQuestionRef[] {
  const copy = [...refs];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy.map((r, i) => ({ ...r, order: i }));
}

/**
 * Ensures that an exam document contains complete redacted question snapshots.
 * Automatically called by auditor flows (ExamListScreen, AssignAgentsModal) to heal legacy
 * exams that were created before question snapshots were introduced.
 */
export async function populateExamQuestionSnapshots(exam: Exam): Promise<Record<string, Question> | null> {
  const qRefs = exam.questions || [];
  if (qRefs.length === 0) return null;

  const existingSnapshots = exam.questionSnapshots || {};
  const missingIds = qRefs
    .map((r) => r.questionId)
    .filter((id) => !existingSnapshots[id]?.questionText);

  if (missingIds.length === 0) {
    return existingSnapshots;
  }

  const fetchedQuestions = await getQuestionsByIds(missingIds);
  const updatedSnapshots: Record<string, Question> = { ...existingSnapshots };
  for (const q of fetchedQuestions) {
    if (q) {
      updatedSnapshots[q.id] = createRedactedQuestionSnapshot(q);
    }
  }

  await updateExam(exam.id, { questionSnapshots: updatedSnapshots });
  return updatedSnapshots;
}
