"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { fetchQuestionsPage, deleteQuestion, fetchAllModules } from "@/lib/questions";
import type { Question, Difficulty } from "@/types";
import { Badge, Modal, EmptyState } from "@/components/ui/Primitives";
import { QuestionForm } from "./QuestionForm";
import { ExcelImportModal } from "./ExcelImportModal";
import { Search, Plus, Upload, Trash2, Pencil } from "lucide-react";
import type { QueryDocumentSnapshot, DocumentData } from "firebase/firestore";

const DIFF_COLOR: Record<Difficulty, "green" | "amber" | "red"> = {
  easy: "green",
  medium: "amber",
  hard: "red",
};

export function QuestionBankBrowser({ selectable, onSelect, selectedIds }: {
  selectable?: boolean;
  onSelect?: (q: Question) => void;
  selectedIds?: Set<string>;
}) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [modules, setModules] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [module, setModule] = useState("");
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [editing, setEditing] = useState<Question | null | "new">(null);
  const [importOpen, setImportOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (reset: boolean) => {
    setLoading(true);
    const res = await fetchQuestionsPage(
      { search, module: module || undefined, difficulty: (difficulty as Difficulty) || undefined },
      30,
      reset ? undefined : cursor ?? undefined
    );
    setQuestions((prev) => (reset ? res.docs : [...prev, ...res.docs]));
    setCursor(res.lastDoc);
    setHasMore(res.hasMore);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, module, difficulty]);

  useEffect(() => {
    load(true);
    fetchAllModules().then(setModules);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, module, difficulty]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasMore && !loading) load(false);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading, load]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this question permanently?")) return;
    await deleteQuestion(id);
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search questions..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={module} onChange={(e) => setModule(e.target.value)}>
          <option value="">All modules</option>
          {modules.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="input w-auto" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty | "")}>
          <option value="">All difficulties</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
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

      {questions.length === 0 && !loading ? (
        <EmptyState title="No questions found" subtitle="Try adjusting filters, or import your question bank." />
      ) : (
        <div className="space-y-2">
          {questions.map((q) => (
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
                  <Badge>{q.type.replace(/_/g, " ")}</Badge>
                  {q.tags.map((t) => <Badge key={t}>{t}</Badge>)}
                </div>
                <p className="line-clamp-2 text-sm">{q.questionText}</p>
              </div>
              {!selectable && (
                <div className="flex shrink-0 gap-1">
                  <button className="btn-secondary px-2 py-1" onClick={(e) => { e.stopPropagation(); setEditing(q); }}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button className="btn-secondary px-2 py-1 text-red-500" onClick={(e) => { e.stopPropagation(); handleDelete(q.id); }}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
              {selectable && selectedIds?.has(q.id) && <Badge color="brand">Selected</Badge>}
            </div>
          ))}
          <div ref={sentinelRef} className="h-4" />
          {loading && <p className="py-4 text-center text-sm text-slate-400">Loading...</p>}
        </div>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add question" : "Edit question"} wide>
        <QuestionForm existing={editing === "new" ? null : editing} onSaved={() => { setEditing(null); load(true); }} />
      </Modal>

      <ExcelImportModal open={importOpen} onClose={() => setImportOpen(false)} onImported={() => load(true)} />
    </div>
  );
}
