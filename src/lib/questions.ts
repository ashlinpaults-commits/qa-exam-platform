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
  topic?: string;
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

  if (filters.topic) {
    const t = filters.topic.toLowerCase();
    docs = docs.filter((d) => (d.topic || d.feature || "").toLowerCase() === t);
  }

  if (filters.search) {
    const s = filters.search.toLowerCase();
    docs = docs.filter(
      (d) =>
        d.questionText.toLowerCase().includes(s) ||
        (d.topic || "").toLowerCase().includes(s) ||
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
  // Normalize topic and feature so both are consistently populated
  const topic = (data.topic || data.feature || "General").trim();
  const feature = (data.feature || topic).trim();

  // Firestore throws on ANY field with value `undefined` — strip before writing.
  const payload = stripUndefined({
    ...data,
    topic,
    feature,
    createdBy,
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stats: { timesAsked: 0, avgMarks: 0, correctPct: 0, incorrectPct: 0 },
  });
  const ref = await addDoc(collection(db, COL), payload);
  const created = { id: ref.id, ...payload } as Question;
  if (questionBankCache) questionBankCache = [created, ...questionBankCache];
  return created;
}

export async function updateQuestion(id: string, data: Partial<Question>): Promise<Question> {
  const syncData: Partial<Question> = { ...data };
  if (syncData.topic && !syncData.feature) {
    syncData.feature = syncData.topic;
  } else if (syncData.feature && !syncData.topic) {
    syncData.topic = syncData.feature;
  }

  const payload = stripUndefined({
    ...syncData,
    updatedAt: Date.now(),
    version: increment(1),
  });
  await updateDoc(doc(db, COL, id), payload);
  const existing = questionBankCache?.find((q) => q.id === id);
  const updated = {
    ...(existing ?? {}),
    ...syncData,
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

// Fisher-Yates shuffle that guarantees the presentation order does not match
// the authoritative correct order (for arrays with 2+ items).
export function shuffleOrderItems<T>(items: T[]): T[] {
  if (!items || items.length <= 1) return [...(items || [])];
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  // If the shuffle accidentally matches the original answer key, swap first two items
  if (JSON.stringify(arr) === JSON.stringify(items) && arr.length > 1) {
    [arr[0], arr[1]] = [arr[1], arr[0]];
  }
  return arr;
}

// Produces a strictly sanitized, immutable question snapshot for agents.
// Answer keys, internal notes, auditor rubrics, and internal analytics are
// completely excluded from the resulting document payload.
export function createRedactedQuestionSnapshot(q: Question): Question {
  const isDragDrop = q.type === "drag_drop_order";
  const sourceOrder = q.orderItems || (q as any).shuffledOrderItems;
  const shuffledOrderItems = isDragDrop && Array.isArray(sourceOrder) && sourceOrder.length > 0
    ? shuffleOrderItems(sourceOrder)
    : undefined;

  const safe: Question = {
    id: q.id,
    questionText: q.questionText || "",
    type: q.type,
    difficulty: q.difficulty || "medium",
    module: q.module || "",
    feature: q.feature || "",
    tags: Array.isArray(q.tags) ? q.tags : [],
    expectedAnswer: "", // Cleared completely
    version: q.version || 1,
    createdBy: "",
    createdAt: q.createdAt || 0,
    updatedAt: q.updatedAt || 0,
  };

  // Safe presentation-only payloads
  if (q.options && Array.isArray(q.options)) {
    safe.options = q.options;
  }
  if (q.imageUrl) {
    safe.imageUrl = q.imageUrl;
  }
  if (q.caseStudyContext) {
    safe.caseStudyContext = q.caseStudyContext;
  }
  if (shuffledOrderItems) {
    safe.shuffledOrderItems = shuffledOrderItems;
  }

  // Explicitly ensure NO sensitive or internal grading fields exist in the snapshot
  const raw = safe as unknown as Record<string, unknown>;
  delete raw.notes;
  delete raw.auditorNotes;
  delete raw.correctOptionIndex;
  delete raw.orderItems; // Crucial: never expose the authoritative order to agents
  delete raw.gradingCriteria;
  delete raw.rubric;
  delete raw.stats; // Internal question statistics hidden from agents
  delete raw.scoreHistory;
  delete raw.marks;
  delete raw.aiSuggestedScore;
  delete raw.aiReview;
  delete raw.fingerprint;
  delete raw.sourceId;
  delete raw.legacyClassification;

  return stripUndefined(safe);
}

/**
 * Authoritatively extracts the raw text from an agent answer entry.
 * Supports:
 * - string: "answer"
 * - object with answer: { answer: "answer" }
 * - object with value: { value: "answer" }
 * - object with text: { text: "answer" }
 * - object with agentAnswer: { agentAnswer: "answer" }
 * - array (e.g. drag & drop order items): JSON string
 * - primitive number/boolean: string representation
 * - empty object / null / undefined: "" (never returns "[object Object]")
 */
export function extractRawAnswerText(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  if (Array.isArray(raw)) {
    return JSON.stringify(raw);
  }
  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.answer === "string") return obj.answer;
    if (typeof obj.value === "string") return obj.value;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.agentAnswer === "string") return obj.agentAnswer;
    if (obj.answer !== undefined && obj.answer !== null) return String(obj.answer);
    if (obj.value !== undefined && obj.value !== null) return String(obj.value);
    if (obj.text !== undefined && obj.text !== null) return String(obj.text);
    if (obj.agentAnswer !== undefined && obj.agentAnswer !== null) return String(obj.agentAnswer);
    return "";
  }
  return "";
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
