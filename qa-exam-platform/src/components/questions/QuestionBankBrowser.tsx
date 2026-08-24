"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchAllQuestions, invalidateQuestionBankCache, deleteQuestion } from "@/lib/questions";
import type { Question, Difficulty, QuestionType } from "@/types";
import { Badge, Modal, EmptyState } from "@/components/ui/Primitives";
import { QuestionForm } from "./QuestionForm";
import { ExcelImportModal } from "./ExcelImportModal";
import {
  Search,
  Plus,
  Upload,
  Trash2,
  Pencil,
  X,
  SlidersHorizontal,
  RotateCcw,
} from "lucide-react";

const DIFF_COLOR: Record<Difficulty, "green" | "amber" | "red"> = {
  easy: "green",
  medium: "amber",
  hard: "red",
};

const TYPE_LABELS: Record<QuestionType, string> = {
  descriptive: "Descriptive",
  mcq: "Multiple Choice",
  true_false: "True / False",
  image_based: "Image Based",
  case_study: "Case Study",
  drag_drop_order: "Drag & Drop",
};

const PAGE_SIZE = 50;

function normalize(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getQuestionNumber(q: Question) {
  const sourceId = q.sourceId ?? "";
  const parts = sourceId.split("::");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function getReviewer(q: Question) {
  const tag = q.tags.find((t) => t.startsWith("reviewed:"));
  return tag ? tag.slice("reviewed:".length) : "";
}

export function QuestionBankBrowser({
  selectable,
  onSelect,
  selectedIds,
}: {
  selectable?: boolean;
  onSelect?: (q: Question) => void;
  selectedIds?: Set<string>;
}) {
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [search, setSearch] = useState("");
  const [module, setModule] = useState("");
  const [feature, setFeature] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  const [type, setType] = useState<QuestionType | "">("");
  const [reviewStatus, setReviewStatus] = useState<"" | "verified" | "unverified">("");
  const [scenario, setScenario] = useState<"" | "scenario" | "standard">("");
  const [reviewer, setReviewer] = useState("");
  const [questionNo, setQuestionNo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Question | null | "new">(null);
  const [importOpen, setImportOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  async function loadQuestions(force = false) {
    setLoading(true);
    setError("");
    try {
      if (force) invalidateQuestionBankCache();
      const questions = await fetchAllQuestions();
      setAllQuestions(questions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load the question bank.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadQuestions();
  }, []);

  // Ctrl/Cmd + K focuses the search box. This is especially useful when the bank is large.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const modules = useMemo(
    () => Array.from(new Set(allQuestions.map((q) => q.module).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [allQuestions]
  );

  const features = useMemo(() => {
    const source = module ? allQuestions.filter((q) => q.module === module) : allQuestions;
    return Array.from(new Set(source.map((q) => q.feature).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [allQuestions, module]);

  const reviewers = useMemo(() => {
    return Array.from(new Set(allQuestions.map(getReviewer).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [allQuestions]);

  useEffect(() => {
    if (feature && !features.includes(feature)) setFeature("");
  }, [feature, features]);

  const filteredQuestions = useMemo(() => {
    const queryTokens = normalize(search).split(/\s+/).filter(Boolean);
    const wantedNo = normalize(questionNo);

    return allQuestions.filter((q) => {
      if (module && q.module !== module) return false;
      if (feature && q.feature !== feature) return false;
      if (difficulty && q.difficulty !== difficulty) return false;
      if (type && q.type !== type) return false;
      if (reviewer && getReviewer(q) !== reviewer) return false;

      const isVerified = q.tags.includes("verified");
      if (reviewStatus === "verified" && !isVerified) return false;
      if (reviewStatus === "unverified" && isVerified) return false;

      const isScenario = q.tags.includes("scenario-based");
      if (scenario === "scenario" && !isScenario) return false;
      if (scenario === "standard" && isScenario) return false;

      if (wantedNo && !normalize(getQuestionNumber(q)).includes(wantedNo)) return false;

      if (queryTokens.length) {
        const haystack = normalize([
          q.questionText,
          q.expectedAnswer,
          q.module,
          q.feature,
          q.type,
          q.tags.join(" "),
          q.notes,
          q.sourceId,
          getQuestionNumber(q),
          getReviewer(q),
        ].join(" "));
        if (!queryTokens.every((token) => haystack.includes(token))) return false;
      }

      return true;
    });
  }, [allQuestions, search, module, feature, difficulty, type, reviewStatus, scenario, reviewer, questionNo]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, module, feature, difficulty, type, reviewStatus, scenario, reviewer, questionNo]);

  const visibleQuestions = filteredQuestions.slice(0, visibleCount);
  const hasMore = visibleCount < filteredQuestions.length;
  const activeFilterCount = [module, feature, difficulty, type, reviewStatus, scenario, reviewer, questionNo].filter(Boolean).length;

  function clearFilters() {
    setSearch("");
    setModule("");
    setFeature("");
    setDifficulty("");
    setType("");
    setReviewStatus("");
    setScenario("");
    setReviewer("");
    setQuestionNo("");
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this question permanently?")) return;
    await deleteQuestion(id);
    setAllQuestions((prev) => prev.filter((q) => q.id !== id));
  }

  function handleSaved() {
    setEditing(null);
    loadQuestions(true);
  }

  function handleImported() {
    setImportOpen(false);
    loadQuestions(true);
  }

  return (
    <div>
      <div className="card mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              ref={searchRef}
              className="input pl-9 pr-20"
              placeholder="Search question, topic, answer, module, tag..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd className="pointer-events-none absolute right-3 top-2 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400 dark:border-slate-700 dark:bg-slate-700">
              Ctrl K
            </kbd>
          </div>
          <button
            className={`btn-secondary ${showFilters ? "border-brand-300 text-brand-700" : ""}`}
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal className="mr-1.5 h-4 w-4" />
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
          {activeFilterCount > 0 && (
            <button className="btn-secondary" onClick={clearFilters} title="Clear all filters">
              <RotateCcw className="mr-1.5 h-4 w-4" /> Clear
            </button>
          )}
          {!selectable && (
            <>
              <button className="btn-secondary" onClick={() => setImportOpen(true)}>
                <Upload className="mr-1.5 h-4 w-4" /> Import Excel
              </button>
              <button className="btn-primary" onClick={() => setEditing("new")}>
                <Plus className="mr-1.5 h-4 w-4" /> Add question
              </button>
            </>
          )}
        </div>

        {showFilters && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 dark:border-slate-700 sm:grid-cols-3 lg:grid-cols-4">
            <select className="input" value={module} onChange={(e) => setModule(e.target.value)}>
              <option value="">All modules</option>
              {modules.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select className="input" value={feature} onChange={(e) => setFeature(e.target.value)}>
              <option value="">All topics / features</option>
              {features.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty | "")}>
              <option value="">All difficulties</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as QuestionType | "")}>
              <option value="">All question types</option>
              {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select className="input" value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value as typeof reviewStatus)}>
              <option value="">All verification status</option>
              <option value="verified">Verified</option>
              <option value="unverified">Not verified</option>
            </select>
            <select className="input" value={scenario} onChange={(e) => setScenario(e.target.value as typeof scenario)}>
              <option value="">All scenarios</option>
              <option value="scenario">Scenario based</option>
              <option value="standard">Standard</option>
            </select>
            <select className="input" value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
              <option value="">All QA reviewers</option>
              {reviewers.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input
              className="input"
              value={questionNo}
              onChange={(e) => setQuestionNo(e.target.value)}
              placeholder="Question No."
              inputMode="numeric"
            />
          </div>
        )}

        {!loading && !error && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              Showing <strong className="text-slate-700 dark:text-slate-200">{visibleQuestions.length}</strong> of <strong className="text-slate-700 dark:text-slate-200">{filteredQuestions.length}</strong> matching questions
              {search ? ` for “${search}”` : ""}
            </span>
            <span>{allQuestions.length.toLocaleString()} questions in bank</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="card p-10 text-center text-sm text-slate-500">
          Loading question bank once... Search and filters will be instant after this.
        </div>
      ) : error ? (
        <div className="card p-8 text-center">
          <p className="font-medium text-red-600">Could not load questions</p>
          <p className="mt-1 text-sm text-slate-500">{error}</p>
          <button className="btn-secondary mt-4" onClick={() => loadQuestions(true)}>Try again</button>
        </div>
      ) : filteredQuestions.length === 0 ? (
        <EmptyState title="No questions found" subtitle="Try a broader search or clear one of the filters." />
      ) : (
        <div className="space-y-2">
          {visibleQuestions.map((q) => (
            <div
              key={q.id}
              className={`card flex items-start justify-between gap-4 p-4 ${
                selectable ? "cursor-pointer hover:shadow-card-hover" : ""
              } ${selectedIds?.has(q.id) ? "border-brand-400 ring-1 ring-brand-300" : ""}`}
              onClick={() => selectable && onSelect?.(q)}
            >
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <Badge color="brand">{q.module}</Badge>
                  <Badge>{q.feature}</Badge>
                  <Badge color={DIFF_COLOR[q.difficulty]}>{q.difficulty}</Badge>
                  <Badge>{TYPE_LABELS[q.type] ?? q.type.replace(/_/g, " ")}</Badge>
                  {q.tags.map((t) => <Badge key={t}>{t}</Badge>)}
                </div>
                <p className="line-clamp-2 text-sm">{q.questionText}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
                  {getQuestionNumber(q) && <span>Q#{getQuestionNumber(q)}</span>}
                  {getReviewer(q) && <span>QA: {getReviewer(q)}</span>}
                  {q.stats && <span>Asked: {q.stats.timesAsked ?? 0}</span>}
                </div>
              </div>
              {!selectable && (
                <div className="flex shrink-0 gap-1">
                  <button className="btn-secondary px-2 py-1" onClick={(e) => { e.stopPropagation(); setEditing(q); }} title="Edit question">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button className="btn-secondary px-2 py-1 text-red-500" onClick={(e) => { e.stopPropagation(); handleDelete(q.id); }} title="Delete question">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
              {selectable && selectedIds?.has(q.id) && <Badge color="brand">Selected</Badge>}
            </div>
          ))}

          {hasMore && (
            <button className="btn-secondary w-full" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
              Load more ({filteredQuestions.length - visibleCount} remaining)
            </button>
          )}
        </div>
      )}

      {search && (
        <button
          className="fixed bottom-5 right-5 inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-2 text-xs font-medium text-white shadow-lg"
          onClick={() => setSearch("")}
        >
          <X className="h-3.5 w-3.5" /> Clear search
        </button>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add question" : "Edit question"} wide>
        <QuestionForm existing={editing === "new" ? null : editing} onSaved={handleSaved} />
      </Modal>

      <ExcelImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={handleImported} />
    </div>
  );
}
