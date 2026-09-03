import {
  collection, doc, addDoc, updateDoc, deleteDoc, getDocs, getDoc, query,
  where, orderBy, limit as fbLimit, startAfter, writeBatch, serverTimestamp,
  increment, QueryDocumentSnapshot, DocumentData, documentId,
} from "firebase/firestore";
import { db } from "./firebase";
import type { Question, Difficulty, QuestionType } from "@/types";
import { createQuestionFingerprint } from "./excelImport";

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
  const snap = await getDoc(doc(db, COL, id));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Question) : null;
}

export async function getQuestionsByIds(ids: string[]): Promise<Question[]> {
  if (!ids.length) return [];
  // One `in` query returns up to 30 documents, avoiding N individual RPCs.
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  const results: Question[] = [];
  for (const chunk of chunks) {
    const snap = await getDocs(query(collection(db, COL), where(documentId(), "in", chunk)));
    snap.docs.forEach((s) => results.push({ id: s.id, ...s.data() } as Question));
  }
  const order = new Map(ids.map((id, index) => [id, index]));
  results.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return results;
}

export async function createQuestion(
  data: Omit<Question, "id" | "createdAt" | "updatedAt" | "version" | "stats">,
  createdBy: string
): Promise<Question> {
  // Firestore throws (and, since callers rarely catch, silently no-ops in the
  // UI) on ANY field with value `undefined` — and the question form always
  // sends the type-specific fields (options, imageUrl, etc.) as `undefined`
  // for every type that doesn't use them. Strip them before writing.
  const payload = stripUndefined({
    ...data,
    createdBy,
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stats: { timesAsked: 0, avgMarks: 0, correctPct: 0, incorrectPct: 0 },
  });
  const ref = await addDoc(collection(db, COL), payload);
  const created = { id: ref.id, ...payload } as Question;
  // Patch the cache in place instead of invalidating it — avoids a full
  // collection re-read (which is what was actually burning through the
  // Firestore daily read quota on every single save).
  if (questionBankCache) questionBankCache = [created, ...questionBankCache];
  return created;
}

export async function updateQuestion(id: string, data: Partial<Question>): Promise<Question> {
  const payload = stripUndefined({
    ...data,
    updatedAt: Date.now(),
    version: increment(1),
  });
  await updateDoc(doc(db, COL, id), payload);
  const existing = questionBankCache?.find((q) => q.id === id);
  const updated = {
    ...(existing ?? {}),
    ...data,
    id,
    updatedAt: payload.updatedAt as number,
    version: (existing?.version ?? 0) + 1,
  } as Question;
  if (questionBankCache) {
    questionBankCache = questionBankCache.map((q) => (q.id === id ? updated : q));
  }
  return updated;
}

export async function deleteQuestion(id: string) {
  await deleteDoc(doc(db, COL, id));
  if (questionBankCache) questionBankCache = questionBankCache.filter((q) => q.id !== id);
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
// Recursive undefined-value sanitizer. Firestore throws when attempting to write
// `undefined` values anywhere in a document tree.
export function stripUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(stripUndefined) as unknown as T;
  }
  if (typeof obj === "object" && !(obj instanceof Date)) {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v !== undefined) {
        clean[k] = stripUndefined(v);
      }
    }
    return clean as T;
  }
  return obj;
}

// Produces a sanitized, immutable question snapshot with answer keys and
// confidential auditor grading data strictly redacted.
export function createRedactedQuestionSnapshot(q: Question): Question {
  const {
    correctOptionIndex: _droppedIndex,
    expectedAnswer: _droppedExpected,
    orderItems: _droppedOrder,
    ...rest
  } = q;

  return stripUndefined({
    ...rest,
    expectedAnswer: "",
    stats: rest.stats || { timesAsked: 0, avgMarks: 0, correctPct: 0, incorrectPct: 0 },
  });
}

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
  createdQuestions: Question[];
}

// Cross-run duplicate protection works by pre-loading existing content fingerprints
// for the modules in this import, then skipping any row that matches substantive content.
async function loadExistingQuestionSignatures(modules: string[]): Promise<{
  fingerprints: Set<string>;
  sourceIds: Set<string>;
}> {
  const fingerprints = new Set<string>();
  const sourceIds = new Set<string>();
  const uniqueModules = Array.from(new Set(modules));

  for (let i = 0; i < uniqueModules.length; i += 30) {
    const group = uniqueModules.slice(i, i + 30);
    const snap = await getDocs(query(collection(db, COL), where("module", "in", group)));
    snap.docs.forEach((d) => {
      const data = d.data() as Question;
      if (data.sourceId) sourceIds.add(data.sourceId);
      const fp = data.fingerprint || createQuestionFingerprint(data.questionText, data.expectedAnswer, data.module);
      if (fp) fingerprints.add(fp);
    });
  }
  return { fingerprints, sourceIds };
}

export async function bulkCreateQuestions(
  rows: Omit<Question, "id" | "createdAt" | "updatedAt" | "version" | "stats" | "createdBy">[],
  createdBy: string,
  onProgress?: (imported: number, total: number) => void,
  batchSize = 200
): Promise<BulkImportSummary> {
  const summary: BulkImportSummary = {
    imported: 0,
    failed: 0,
    duplicatesSkipped: 0,
    failedBatches: [],
    createdQuestions: [],
  };

  const { fingerprints: existingFingerprints } = await loadExistingQuestionSignatures(rows.map((r) => r.module));

  // Deduplicate against existing substantive content fingerprints, NOT solely Question No.
  const toUpload = rows.filter((r) => {
    const fp = r.fingerprint || createQuestionFingerprint(r.questionText, r.expectedAnswer, r.module);
    if (existingFingerprints.has(fp)) {
      summary.duplicatesSkipped++;
      return false;
    }
    existingFingerprints.add(fp);
    return true;
  });

  for (let i = 0; i < toUpload.length; i += batchSize) {
    const chunk = toUpload.slice(i, i + batchSize);
    const batch = writeBatch(db);
    const batchQuestions: Question[] = [];

    chunk.forEach((row) => {
      const ref = doc(collection(db, COL));
      const fp = row.fingerprint || createQuestionFingerprint(row.questionText, row.expectedAnswer, row.module);
      const now = Date.now();
      const questionDoc: Omit<Question, "id"> = {
        ...row,
        fingerprint: fp,
        createdBy,
        version: 1,
        createdAt: now,
        updatedAt: now,
        stats: { timesAsked: 0, avgMarks: 0, correctPct: 0, incorrectPct: 0 },
      };
      const cleaned = stripUndefined(questionDoc);
      batch.set(ref, cleaned);
      batchQuestions.push({ id: ref.id, ...cleaned } as Question);
    });

    const result = await commitWithRetry(batch);
    if (result.ok) {
      summary.imported += chunk.length;
      summary.createdQuestions.push(...batchQuestions);
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
  // Reuse the already-loaded bank instead of issuing a second full collection
  // read when the question browser and a module filter mount together.
  const questions = await fetchAllQuestions();
  return Array.from(new Set(questions.map((question) => question.module))).sort();
}
