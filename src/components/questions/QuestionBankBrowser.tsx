"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchAllQuestions, invalidateQuestionBankCache, deleteQuestion } from "@/lib/questions";
import type { Question, Difficulty, QuestionType } from "@/types";
import { Badge, Modal, EmptyState } from "@/components/ui/Primitives";
import { QuestionForm } from "./QuestionForm";
import { ExcelImportModal } from "./ExcelImportModal";
import { QuestionContent } from "./QuestionContent";
import {
  Search,
  Plus,
  Upload,
  Trash2,
  Pencil,
  X,
  SlidersHorizontal,
  RotateCcw,
  Eye,
  BookOpen,
  Calendar,
  Layers,
  CheckCircle2,
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

function formatDate(timestamp?: number): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
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
  const [previewing, setPreviewing] = useState<Question | null>(null);
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

  // Ctrl/Cmd + K shortcut for search
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

  const verifiedCount = useMemo(() => {
    return allQuestions.filter((q) => q.tags.includes("verified")).length;
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
    if (!confirm("Delete this question from the Question Bank? Warning: Questions currently referenced by existing exams or attempts may be affected.")) return;
    try {
      await deleteQuestion(id);
      invalidateQuestionBankCache();
      setAllQuestions((prev) => prev.filter((q) => q.id !== id));
    } catch (err) {
      console.error("Failed to delete question", err);
      setError(err instanceof Error ? err.message : "Couldn't delete question. Please retry.");
    }
  }

  function handleSaved(saved: Question) {
    setEditing(null);
    setAllQuestions((prev) => {
      const exists = prev.some((q) => q.id === saved.id);
      return exists ? prev.map((q) => (q.id === saved.id ? saved : q)) : [saved, ...prev];
    });
  }

  function handleImported() {
    setImportOpen(false);
    loadQuestions(true);
  }

  return (
    <div className="space-y-4">
      {/* Standalone Workspace Header (Shown only on the Question Bank page, not inside ExamBuilder) */}
      {!selectable && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                Assessment Content Library
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Ingest questions from Excel sheets or search the existing repository.
            </p>
          </div>

          {/* Primary Action is prominently Import from Excel */}
          <div className="flex items-center gap-2">
            <button className="btn-primary" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1.5 h-4 w-4" /> Import from Excel
            </button>
            <button className="btn-secondary" onClick={() => setEditing("new")}>
              <Plus className="mr-1.5 h-4 w-4" /> Add Question
            </button>
          </div>
        </div>
      )}

      {/* Operational Metrics Row (Standalone mode) */}
      {!selectable && allQuestions.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Total Questions</p>
            <p className="mt-0.5 text-xl font-bold text-slate-900 dark:text-slate-100">{allQuestions.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Modules</p>
            <p className="mt-0.5 text-xl font-bold text-slate-900 dark:text-slate-100">{modules.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Topics / Features</p>
            <p className="mt-0.5 text-xl font-bold text-slate-900 dark:text-slate-100">{features.length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Verified</p>
            <p className="mt-0.5 text-xl font-bold text-emerald-600 dark:text-emerald-400">{verifiedCount}</p>
          </div>
        </div>
      )}

      {/* Search & Filter Toolbar */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              ref={searchRef}
              className="input pl-9 pr-20"
              placeholder="Search questions, topics, answers, modules..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd className="pointer-events-none absolute right-3 top-2 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-400 dark:border-slate-700 dark:bg-slate-700">
              Ctrl K
            </kbd>
          </div>

          <button
            className={`btn-secondary ${showFilters ? "border-brand-300 text-brand-700 dark:border-brand-700 dark:text-brand-300" : ""}`}
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

          {selectable && (
            <button className="btn-secondary" onClick={() => setImportOpen(true)} title="Import into library">
              <Upload className="mr-1.5 h-4 w-4" /> Import Excel
            </button>
          )}
        </div>

        {/* Collapsible Filter Row */}
        {showFilters && (
          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 dark:border-slate-700 sm:grid-cols-3 lg:grid-cols-4">
            <select className="input text-xs" value={module} onChange={(e) => setModule(e.target.value)}>
              <option value="">All modules</option>
              {modules.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select className="input text-xs" value={feature} onChange={(e) => setFeature(e.target.value)}>
              <option value="">All topics / features</option>
              {features.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select className="input text-xs" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty | "")}>
              <option value="">All difficulties</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <select className="input text-xs" value={type} onChange={(e) => setType(e.target.value as QuestionType | "")}>
              <option value="">All question types</option>
              {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <select className="input text-xs" value={reviewStatus} onChange={(e) => setReviewStatus(e.target.value as typeof reviewStatus)}>
              <option value="">All verification</option>
              <option value="verified">Verified</option>
              <option value="unverified">Not verified</option>
            </select>
            <select className="input text-xs" value={scenario} onChange={(e) => setScenario(e.target.value as typeof scenario)}>
              <option value="">All scenarios</option>
              <option value="scenario">Scenario based</option>
              <option value="standard">Standard</option>
            </select>
            <select className="input text-xs" value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
              <option value="">All QA reviewers</option>
              {reviewers.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input
              className="input text-xs"
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
            <span>{allQuestions.length.toLocaleString()} total in bank</span>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="card p-10 text-center text-sm text-slate-500">
          Loading question bank...
        </div>
      ) : error ? (
        <div className="card p-8 text-center">
          <p className="font-medium text-red-600">Could not load questions</p>
          <p className="mt-1 text-sm text-slate-500">{error}</p>
          <button className="btn-secondary mt-4" onClick={() => loadQuestions(true)}>Try again</button>
        </div>
      ) : filteredQuestions.length === 0 ? (
        <EmptyState
          title="No questions found"
          subtitle={search || activeFilterCount > 0 ? "Try a broader search or clear your filters." : "Import your first Excel sheet to populate the question bank."}
        />
      ) : selectable ? (
        /* Selectable Card View for ExamBuilder */
        <div className="space-y-2">
          {visibleQuestions.map((q) => (
            <div
              key={q.id}
              className={`card flex cursor-pointer items-start justify-between gap-3 p-3 transition hover:shadow-card-hover ${
                selectedIds?.has(q.id) ? "border-brand-500 bg-brand-50/20 ring-1 ring-brand-300 dark:bg-brand-900/10" : ""
              }`}
              onClick={() => onSelect?.(q)}
            >
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <Badge color="brand">{q.module}</Badge>
                  <Badge>{q.feature}</Badge>
                  <Badge color={DIFF_COLOR[q.difficulty]}>{q.difficulty}</Badge>
                </div>
                <p className="line-clamp-2 text-xs text-slate-700 dark:text-slate-200">{q.questionText}</p>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400">
                  {getQuestionNumber(q) && <span>Q#{getQuestionNumber(q)}</span>}
                  <span>{TYPE_LABELS[q.type]}</span>
                </div>
              </div>
              <div className="shrink-0 pt-1">
                {selectedIds?.has(q.id) ? (
                  <Badge color="brand">Selected</Badge>
                ) : (
                  <span className="text-xs font-medium text-slate-400 hover:text-brand-600">+ Add</span>
                )}
              </div>
            </div>
          ))}

          {hasMore && (
            <button className="btn-secondary w-full" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
              Load more ({filteredQuestions.length - visibleCount} remaining)
            </button>
          )}
        </div>
      ) : (
        /* High-Density Compact Assessment Table for Standalone Question Bank View */
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/60">
                <tr>
                  <th className="py-2.5 pl-4 pr-2 font-semibold">Q#</th>
                  <th className="px-3 py-2.5 font-semibold">Module & Topic</th>
                  <th className="px-3 py-2.5 font-semibold">Question Content</th>
                  <th className="px-3 py-2.5 font-semibold">Type</th>
                  <th className="px-3 py-2.5 font-semibold">Difficulty</th>
                  <th className="px-3 py-2.5 font-semibold">Usage</th>
                  <th className="px-3 py-2.5 font-semibold">Date</th>
                  <th className="py-2.5 pl-2 pr-4 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {visibleQuestions.map((q) => {
                  const qNum = getQuestionNumber(q);

                  return (
                    <tr
                      key={q.id}
                      className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                    >
                      {/* Q# */}
                      <td className="py-3 pl-4 pr-2 font-mono text-[11px] font-bold text-slate-500">
                        {qNum ? `#${qNum}` : "—"}
                      </td>

                      {/* Module & Topic */}
                      <td className="whitespace-nowrap px-3 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-semibold text-slate-800 dark:text-slate-100">{q.module}</span>
                          <span className="text-[11px] text-slate-400">{q.feature}</span>
                        </div>
                      </td>

                      {/* Question Content */}
                      <td className="max-w-md px-3 py-3">
                        <p
                          className="line-clamp-2 cursor-pointer text-slate-700 hover:text-brand-700 dark:text-slate-300 dark:hover:text-brand-300"
                          onClick={() => setPreviewing(q)}
                          title="Click to preview full question"
                        >
                          {q.questionText}
                        </p>
                      </td>

                      {/* Type */}
                      <td className="whitespace-nowrap px-3 py-3">
                        <Badge color="slate">{TYPE_LABELS[q.type] ?? q.type}</Badge>
                      </td>

                      {/* Difficulty */}
                      <td className="whitespace-nowrap px-3 py-3">
                        <Badge color={DIFF_COLOR[q.difficulty]}>{q.difficulty}</Badge>
                      </td>

                      {/* Usage */}
                      <td className="whitespace-nowrap px-3 py-3 text-slate-500">
                        <span>{q.stats?.timesAsked ?? 0} {q.stats?.timesAsked === 1 ? "time" : "times"}</span>
                      </td>

                      {/* Date */}
                      <td className="whitespace-nowrap px-3 py-3 text-[11px] text-slate-400">
                        {formatDate(q.createdAt || q.updatedAt)}
                      </td>

                      {/* Actions */}
                      <td className="whitespace-nowrap py-3 pl-2 pr-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            onClick={() => setPreviewing(q)}
                            title="Preview formatted question"
                            aria-label="Preview formatted question"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            onClick={() => setEditing(q)}
                            title="Edit question"
                            aria-label="Edit question"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                            onClick={() => handleDelete(q.id)}
                            title="Delete question"
                            aria-label="Delete question"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="border-t border-slate-100 p-3 text-center dark:border-slate-800">
              <button className="btn-secondary w-full" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
                Load more ({filteredQuestions.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {/* 1. Full Formatted Question Preview Modal */}
      <Modal
        open={previewing !== null}
        onClose={() => setPreviewing(null)}
        title={`Question Preview — ${previewing?.module ?? ""} / ${previewing?.feature ?? ""}`}
        wide
      >
        {previewing && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge color="brand">{previewing.module}</Badge>
              <Badge>{previewing.feature}</Badge>
              <Badge color={DIFF_COLOR[previewing.difficulty]}>{previewing.difficulty}</Badge>
              <Badge color="slate">{TYPE_LABELS[previewing.type]}</Badge>
              {getQuestionNumber(previewing) && <Badge color="slate">Q#{getQuestionNumber(previewing)}</Badge>}
              {previewing.tags.map((t) => <Badge key={t}>{t}</Badge>)}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Question Text</p>
              <QuestionContent content={previewing.questionText} className="text-base" />
            </div>

            {previewing.caseStudyContext && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Case / Ticket Context</p>
                <QuestionContent content={previewing.caseStudyContext} className="text-sm" />
              </div>
            )}

            {previewing.type === "mcq" && previewing.options && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Options</p>
                <ul className="space-y-1.5 text-sm">
                  {previewing.options.map((opt, i) => (
                    <li key={i} className={`flex items-center gap-2 ${i === previewing.correctOptionIndex ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-slate-600 dark:text-slate-300"}`}>
                      <span className="font-mono text-xs">{String.fromCharCode(65 + i)})</span>
                      <span>{opt}</span>
                      {i === previewing.correctOptionIndex && <span className="text-xs text-emerald-600 font-bold">✓ (Correct)</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 dark:border-emerald-900/30 dark:bg-emerald-950/20">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                Expected Answer (Grading Reference)
              </p>
              <QuestionContent content={previewing.expectedAnswer} className="text-sm text-slate-800 dark:text-slate-200" />
            </div>

            {previewing.notes && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/40">
                <strong className="text-slate-700 dark:text-slate-300">Auditor Notes:</strong> {previewing.notes}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setPreviewing(null)}>Close</button>
              <button className="btn-primary" onClick={() => { setEditing(previewing); setPreviewing(null); }}>
                <Pencil className="mr-1.5 h-4 w-4" /> Edit Question
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* 2. Add / Edit Question Form Modal */}
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add Question to Library" : "Edit Question"} wide>
        <QuestionForm existing={editing === "new" ? null : editing} onSaved={handleSaved} />
      </Modal>

      {/* 3. Excel Import Modal */}
      <ExcelImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={handleImported} />
    </div>
  );
}

