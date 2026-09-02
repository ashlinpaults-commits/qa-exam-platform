import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, getDoc, query,
  where, orderBy, limit as fbLimit, startAfter, writeBatch, serverTimestamp,
  increment, QueryDocumentSnapshot, DocumentData,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Question, Difficulty, QuestionType, QuestionVersion } from "@/types";

const COL = "questions";

// Client-side question-bank cache used by the auditor browser. The question bank
// is only a few thousand records today, so loading it once and filtering locally
// makes search effectively instant instead of issuing a Firestore request on every
// keystroke. The cache is invalidated after writes/imports.
let questionBankCache: Question[] | null = null;
let questionBankCachePromise: Promise<Question[]> | null = null;

export async function fetchAllQuestions(): Promise<Question[]> {
  if (questionBankCache) return questionBankCache;
  if (questionBankCachePromise) return questionBankCachePromise;

  questionBankCachePromise = getDocs(collection(db, COL)).then((snap) => {
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Question));
    docs.sort((a, b) => b.createdAt - a.createdAt);
    questionBankCache = docs;
    return docs;
  }).finally(() => {
    questionBankCachePromise = null;
  });

  return questionBankCachePromise;
}

export function invalidateQuestionBankCache() {
  questionBankCache = null;
}

export interface QuestionFilters {
  search?: string;
  module?: string;
  difficulty?: Difficulty;
  tags?: string[];
  type?: QuestionType;
}

// Firestore full-text search is limited, so we filter module/difficulty server-side
// and do search/tags client-side against the loaded page. Fine up to a few thousand docs;
// for true full-text at scale, swap in Algolia/Typesense later.
export async function fetchQuestionsPage(
  filters: QuestionFilters,
  pageSize = 50,
  cursor?: QueryDocumentSnapshot<DocumentData>
) {
  const clauses = [];
  if (filters.module) clauses.push(where("module", "==", filters.module));
  if (filters.difficulty) clauses.push(where("difficulty", "==", filters.difficulty));
  if (filters.type) clauses.push(where("type", "==", filters.type));

  let q = query(collection(db, COL), ...clauses, orderBy("createdAt", "desc"), fbLimit(pageSize));
  if (cursor) {
    q = query(collection(db, COL), ...clauses, orderBy("createdAt", "desc"), startAfter(cursor), fbLimit(pageSize));
  }
  const snap = await getDocs(q);
  let docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Question));

  if (filters.search) {
    const s = filters.search.toLowerCase();
    docs = docs.filter(
      (d) =>
        d.questionText.toLowerCase().includes(s) ||
        d.feature.toLowerCase().includes(s) ||
        d.expectedAnswer.toLowerCase().includes(s)
    );
  }
  if (filters.tags?.length) {
    docs = docs.filter((d) => filters.tags!.some((t) => d.tags.includes(t)));
  }

  return { docs, lastDoc: snap.docs[snap.docs.length - 1] ?? null, hasMore: snap.docs.length === pageSize };
}

export async function getQuestion(id: string): Promise<Question | null> {
  if (questionBankCache) {
    const cached = questionBankCache.find((q) => q.id === id);
    if (cached) return cached;
  }
  const snap = await getDoc(doc(db, COL, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Question) : null;
}

export async function getQuestionsByIds(ids: string[]): Promise<Question[]> {
  if (ids.length === 0) return [];
  if (questionBankCache) {
    const map = new Map(questionBankCache.map((q) => [q.id, q]));
    const allFound = ids.map((id) => map.get(id)).filter(Boolean) as Question[];
    if (allFound.length === ids.length) return allFound;
  }
  // Firestore has no "IN with >30" without chunking; chunk into groups of 30.
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const results: Question[] = [];
  for (const chunk of chunks) {
    const snaps = await Promise.all(chunk.map((id) => getDoc(doc(db, COL, id))));
    snaps.forEach((s) => s.exists() && results.push({ id: s.id, ...s.data() } as Question));
  }
  return results;
}

export function normalizeQuestionText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export async function checkDuplicateQuestionText(
  questionText: string,
  excludeId?: string
): Promise<boolean> {
  const normalizedTarget = normalizeQuestionText(questionText);
  if (!normalizedTarget) return false;

  const all = await fetchAllQuestions();
  return all.some(
    (q) =>
      q.id !== excludeId &&
      normalizeQuestionText(q.questionText) === normalizedTarget
  );
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) clean[k] = v;
  }
  return clean as T;
}

export async function createQuestion(
  data: Omit<Question, "id" | "createdAt" | "updatedAt" | "version" | "stats">,
  createdBy: string
): Promise<Question> {
  const isDuplicate = await checkDuplicateQuestionText(data.questionText);
  if (isDuplicate) {
    throw new Error("A question with this exact text already exists in the Question Bank.");
  }
  const now = Date.now();
  const payload = stripUndefined({
    ...data,
    createdBy,
    version: 1,
    createdAt: now,
    updatedAt: now,
    stats: { timesAsked: 0, avgMarks: 0, correctPct: 0, incorrectPct: 0 },
  });
  const ref = await addDoc(collection(db, COL), payload);
  const newQuestion: Question = {
    id: ref.id,
    ...(payload as any),
  };
  if (questionBankCache) {
    questionBankCache = [newQuestion, ...questionBankCache];
  }
  return newQuestion;
}

export async function updateQuestion(id: string, data: Partial<Question>, updatedBy?: string): Promise<void> {
  if (data.questionText) {
    const isDuplicate = await checkDuplicateQuestionText(data.questionText, id);
    if (isDuplicate) {
      throw new Error("Another question with this exact text already exists in the Question Bank.");
    }
  }

  // Snapshot previous question version before applying updates
  try {
    const existing = await getQuestion(id);
    if (existing) {
      const versionDoc: Omit<QuestionVersion, "id"> = {
        questionId: id,
        version: existing.version || 1,
        module: existing.module,
        feature: existing.feature,
        difficulty: existing.difficulty,
        tags: existing.tags ?? [],
        type: existing.type,
        questionText: existing.questionText,
        expectedAnswer: existing.expectedAnswer,
        notes: existing.notes,
        options: existing.options,
        correctOptionIndex: existing.correctOptionIndex,
        imageUrl: existing.imageUrl,
        caseStudyContext: existing.caseStudyContext,
        orderItems: existing.orderItems,
        updatedAt: existing.updatedAt || existing.createdAt || Date.now(),
        updatedBy: updatedBy || existing.createdBy,
      };
      await addDoc(collection(db, COL, id, "versions"), stripUndefined(versionDoc as Record<string, unknown>));
    }
  } catch (err) {
    console.error("Failed to snapshot previous question version:", err);
  }

  const cleanData = stripUndefined({
    ...data,
    updatedAt: Date.now(),
    version: increment(1),
  });
  await updateDoc(doc(db, COL, id), cleanData);
  if (questionBankCache) {
    questionBankCache = questionBankCache.map((q) =>
      q.id === id
        ? {
            ...q,
            ...stripUndefined(data as Record<string, unknown>),
            updatedAt: Date.now(),
            version: (q.version || 1) + 1,
          }
        : q
    );
  }
}

export async function getQuestionVersions(questionId: string): Promise<QuestionVersion[]> {
  try {
    const q = query(
      collection(db, COL, questionId, "versions"),
      orderBy("version", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<QuestionVersion, "id">),
    }));
  } catch (err) {
    console.error("Failed to fetch question versions:", err);
    return [];
  }
}

export async function deleteQuestion(id: string): Promise<void> {
  await deleteDoc(doc(db, COL, id));
  if (questionBankCache) {
    questionBankCache = questionBankCache.filter((q) => q.id !== id);
  }
}

// Bulk insert used by the Excel importer.
//
// Batches of 200 (well under Firestore's 500-writes-per-batch cap, and small
// enough that one bad batch retry doesn't re-send a huge payload). Each batch
// is awaited before the next starts — no parallel fan-out, so we never
// overrun Firestore's sustained write-rate limits on a large import.
//
// Firestore rejects any field with value `undefined` and aborts the WHOLE
// batch when it hits one — so every row is sanitized (undefined keys
// stripped) before it's added to a batch. This was the actual cause of the
// "fails partway through" bug: blank Comments cells produced `notes: undefined`.
//
// Failed batches are retried up to 3 times with exponential backoff before
// being counted as failed and moving on — a transient network blip no longer
// kills the rest of the import.

async function commitWithRetry(batch: ReturnType<typeof writeBatch>, maxRetries = 3): Promise<{ ok: boolean; error?: string }> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      await batch.commit();
      return { ok: true };
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) {
        return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
      }
      await new Promise((res) => setTimeout(res, 500 * 2 ** (attempt - 1))); // 500ms, 1s, 2s
    }
  }
  return { ok: false, error: "Retry loop exhausted" };
}

export interface BulkImportSummary {
  imported: number;
  failed: number;
  duplicatesSkipped: number;
  failedBatches: { startIndex: number; count: number; error: string }[];
}

export async function bulkCreateQuestions(
  rows: Omit<Question, "id" | "createdAt" | "updatedAt" | "version" | "stats">[],
  createdBy: string,
  onProgress?: (imported: number, total: number) => void,
  batchSize = 200
): Promise<BulkImportSummary> {
  const summary: BulkImportSummary = { imported: 0, failed: 0, duplicatesSkipped: 0, failedBatches: [] };

  const allExisting = await fetchAllQuestions();
  const existingTexts = new Set(allExisting.map((q) => normalizeQuestionText(q.questionText)));

  const toUpload = rows.filter((r) => {
    const norm = normalizeQuestionText(r.questionText);
    if (!norm) return false;
    if (existingTexts.has(norm)) {
      summary.duplicatesSkipped++;
      return false;
    }
    existingTexts.add(norm); // catch dupes within this same run too
    return true;
  });

  for (let i = 0; i < toUpload.length; i += batchSize) {
    const chunk = toUpload.slice(i, i + batchSize);
    const batch = writeBatch(db);
    chunk.forEach((row) => {
      const ref = doc(collection(db, COL));
      batch.set(
        ref,
        stripUndefined({
          ...row,
          createdBy,
          version: 1,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          stats: { timesAsked: 0, avgMarks: 0, correctPct: 0, incorrectPct: 0 },
        })
      );
    });

    const result = await commitWithRetry(batch);
    if (result.ok) {
      summary.imported += chunk.length;
    } else {
      summary.failed += chunk.length;
      summary.failedBatches.push({ startIndex: i, count: chunk.length, error: result.error ?? "Unknown error" });
    }
    onProgress?.(summary.imported + summary.failed + summary.duplicatesSkipped, rows.length);
  }

  invalidateQuestionBankCache();
  return summary;
}

export async function fetchAllModules(): Promise<string[]> {
  // Denormalized read: pull all questions' module field. Fine at low thousands;
  // if the bank grows past ~10k, maintain a separate `modules` collection instead.
  const snap = await getDocs(collection(db, COL));
  const set = new Set<string>();
  snap.docs.forEach((d) => set.add((d.data() as Question).module));
  return Array.from(set).sort();
}
