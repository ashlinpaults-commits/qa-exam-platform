import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, getDoc, query,
  where, orderBy, writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Exam, ExamStatus, ExamQuestionRef } from "@/types";

const COL = "exams";

export async function fetchExams(status?: ExamStatus): Promise<Exam[]> {
  const q = status
    ? query(collection(db, COL), where("status", "==", status), orderBy("updatedAt", "desc"))
    : query(collection(db, COL), orderBy("updatedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Exam));
}

export async function fetchAssignedExams(agentId: string): Promise<Exam[]> {
  const q = query(
    collection(db, COL),
    where("assignedAgentIds", "array-contains", agentId),
    where("status", "in", ["published", "active"])
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Exam));
}

export async function getExam(id: string): Promise<Exam | null> {
  const snap = await getDoc(doc(db, COL, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Exam) : null;
}

export async function createExam(
  data: Omit<Exam, "id" | "createdAt" | "updatedAt" | "createdBy">,
  createdBy: string
) {
  const ref = await addDoc(collection(db, COL), {
    ...data,
    createdBy,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return ref.id;
}

export async function updateExam(id: string, data: Partial<Exam>) {
  await updateDoc(doc(db, COL, id), { ...data, updatedAt: Date.now() });
}

export async function deleteExam(id: string) {
  await deleteDoc(doc(db, COL, id));
}

export async function duplicateExam(examId: string, createdBy: string): Promise<Exam> {
  const original = await getExam(examId);
  if (!original) throw new Error("Exam not found");
  const { id: _drop, ...rest } = original;
  const now = Date.now();
  const newPayload = {
    ...rest,
    name: `${original.name} (Copy)`,
    status: "draft" as const,
    assignedAgentIds: [],
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
  const ref = await addDoc(collection(db, COL), newPayload);
  return { id: ref.id, ...newPayload };
}

export function reorderQuestions(refs: ExamQuestionRef[], fromIndex: number, toIndex: number): ExamQuestionRef[] {
  const copy = [...refs];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy.map((r, i) => ({ ...r, order: i }));
}
