import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, getDoc, query,
  where, orderBy,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Exam, ExamStatus, ExamQuestionRef, Question } from "@/types";
import { stripUndefined, getQuestionsByIds, createRedactedQuestionSnapshot } from "./questions";

import { normalizeLegacyModule, ControlledModule } from "@/config/taxonomy";

const COL = "exams";

function normalizeExamDoc(id: string, raw: Partial<Exam>): Exam {
  // Infer batch, module, assessmentType from name if not directly present
  const parsed = parseExamNameComponents(raw.name || "");
  const batch = raw.batch || (raw.batchId ? raw.batchId : parsed.batch);
  const resolvedModule = raw.module || (raw.category ? normalizeLegacyModule(raw.category) : parsed.module);
  const assessmentType = raw.assessmentType || parsed.assessmentType || "Test";
  const testNumber = raw.testNumber ?? parsed.testNumber;

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
    batchId: raw.batchId || batch,
    batch,
    module: resolvedModule,
    assessmentType,
    testNumber,
    moduleScope: raw.moduleScope,
    timeLimitMinutes: raw.timeLimitMinutes,
    createdBy: raw.createdBy || "",
    createdAt: raw.createdAt || Date.now(),
    updatedAt: raw.updatedAt || Date.now(),
  };
}

/**
 * Generates a standardized exam name in the required format:
 * [BATCH] | [MODULE] | [ASSESSMENT] [NUM]
 * Example: PS1126 | RCM & Clinical | Test 01
 */
export function formatStandardExamName(
  batch: string,
  module: string,
  assessmentType = "Test",
  testNumber = 1
): string {
  const cleanBatch = batch.trim().replace(/\s+/g, "");
  const cleanModule = module.trim();
  const cleanType = assessmentType.trim();
  const padNumber = String(testNumber).padStart(2, "0");
  return `${cleanBatch} | ${cleanModule} | ${cleanType} ${padNumber}`;
}

export interface ParsedExamComponents {
  batch?: string;
  module?: ControlledModule;
  assessmentType: string;
  testNumber?: number;
}

/**
 * Parses components from legacy or standardized exam names.
 */
export function parseExamNameComponents(rawName: string): ParsedExamComponents {
  const clean = rawName.trim();
  if (!clean) return { assessmentType: "Test" };

  // 1. Extract Batch (e.g. "PS1126", "PS 1126", "B12", etc.)
  let batch: string | undefined;
  const batchMatch = clean.match(/^([A-Za-z0-9]+(?:\s*[0-9]+)?)\s*(?:\|{1,2}|-)/);
  if (batchMatch) {
    batch = batchMatch[1].replace(/\s+/g, "").toUpperCase();
  }

  // 2. Extract Test/Assessment Number (e.g. "Test 01", "Test 1", "Day 2", "Assessment 3")
  let testNumber: number | undefined;
  let assessmentType = "Test";
  const numMatch = clean.match(/\b(Test|Quiz|Evaluation|Assessment|Midterm|Final|Day)\s*[-:]?\s*(\d+)\b/i);
  if (numMatch) {
    assessmentType = numMatch[1].charAt(0).toUpperCase() + numMatch[1].slice(1).toLowerCase();
    if (assessmentType.toLowerCase() === "day") assessmentType = "Test";
    testNumber = parseInt(numMatch[2], 10);
  }

  // 3. Extract Module
  const norm = clean.toLowerCase();
  let parsedModule: ControlledModule | undefined;
  if (
    norm.includes("report") ||
    norm.includes("audit") ||
    norm.includes("analytics")
  ) {
    parsedModule = "Reporting";
  } else if (
    norm.includes("rcm") ||
    norm.includes("clinical") ||
    norm.includes("0909") ||
    norm.includes("revenue cycle")
  ) {
    parsedModule = "RCM & Clinical";
  } else if (
    norm.includes("engagement") ||
    norm.includes("p.e") ||
    norm.includes("pe |") ||
    norm.includes("| pe") ||
    norm.includes("patient services") ||
    norm.includes("services") ||
    norm.includes("scheduler") ||
    norm.includes("scheduling")
  ) {
    parsedModule = "Patient Engagement";
  }

  return { batch, module: parsedModule, assessmentType, testNumber };
}

/**
 * Determines the next exam number for a Batch + Module + Assessment combination
 * by inspecting existing exams in the database.
 */
export function getNextExamNumber(
  existingExams: Exam[],
  batch: string,
  module: string,
  assessmentType = "Test"
): number {
  const normBatch = batch.trim().replace(/\s+/g, "").toLowerCase();
  const normModule = normalizeLegacyModule(module);
  const normType = assessmentType.trim().toLowerCase();

  let maxNumber = 0;

  for (const exam of existingExams) {
    const examBatch = (exam.batch || "").trim().replace(/\s+/g, "").toLowerCase();
    const examModule = exam.module ? normalizeLegacyModule(exam.module) : undefined;
    const examType = (exam.assessmentType || "Test").trim().toLowerCase();

    // Check direct properties or parsed components
    const parsed = parseExamNameComponents(exam.name || "");
    const parsedBatch = (parsed.batch || "").toLowerCase();
    const parsedModule = parsed.module;
    const parsedType = (parsed.assessmentType || "Test").toLowerCase();

    const matchesBatch = examBatch === normBatch || parsedBatch === normBatch;
    const matchesModule = examModule === normModule || parsedModule === normModule;
    const matchesType = examType === normType || parsedType === normType;

    if (matchesBatch && matchesModule && matchesType) {
      const num = exam.testNumber ?? parsed.testNumber ?? 0;
      if (num > maxNumber) {
        maxNumber = num;
      }
    }
  }

  return maxNumber + 1;
}

/**
 * Extracts all unique batches currently represented across exams.
 */
export function getKnownBatches(exams: Exam[]): string[] {
  const batches = new Set<string>();
  for (const exam of exams) {
    if (exam.batch) batches.add(exam.batch.trim().toUpperCase());
    const parsed = parseExamNameComponents(exam.name || "");
    if (parsed.batch) batches.add(parsed.batch.trim().toUpperCase());
  }
  // Default to PS1126 if none found
  if (!batches.size) batches.add("PS1126");
  return Array.from(batches).sort();
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
