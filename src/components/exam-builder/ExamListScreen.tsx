"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchExams, duplicateExam, updateExam, deleteExam } from "@/lib/exams";
import type { Exam, ExamStatus, ExamMode } from "@/types";
import { Badge, EmptyState, Modal } from "@/components/ui/Primitives";
import { useAuth } from "@/context/AuthContext";
import { Copy, Trash2, Users, Plus, Search, Archive, ArchiveRestore, RotateCcw } from "lucide-react";
import { AssignAgentsModal } from "./AssignAgentsModal";

const STATUS_COLOR: Record<ExamStatus, "slate" | "brand" | "green" | "amber" | "red"> = {
  draft: "slate",
  published: "brand",
  active: "amber",
  completed: "green",
  archived: "red",
};

const PAGE_SIZE = 25;

export function ExamListScreen() {
  const { profile } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<Exam | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ExamStatus | "">("");
  const [modeFilter, setModeFilter] = useState<ExamMode | "">("");
  const [currentPage, setCurrentPage] = useState(1);

  async function load() {
    setLoading(true);
    try {
      setExams(await fetchExams());
    } catch (error) {
      console.error("Failed to load exams", error);
      alert(error instanceof Error ? error.message : "Couldn't load exams. Please retry.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredExams = useMemo(() => {
    const q = search.trim().toLowerCase();
    return exams.filter((exam) => {
      if (statusFilter && exam.status !== statusFilter) return false;
      if (modeFilter && exam.mode !== modeFilter) return false;
      if (q) {
        const text = `${exam.name} ${exam.description}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [exams, search, statusFilter, modeFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, modeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredExams.length / PAGE_SIZE));
  const visibleExams = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredExams.slice(start, start + PAGE_SIZE);
  }, [filteredExams, currentPage]);

  const activeFilterCount = [statusFilter, modeFilter].filter(Boolean).length;

  function clearFilters() {
    setSearch("");
    setStatusFilter("");
    setModeFilter("");
    setCurrentPage(1);
  }

  async function handleDuplicate(id: string) {
    if (!profile) return;
    try {
      const copy = await duplicateExam(id, profile.uid);
      setExams((prev) => [copy, ...prev]);
    } catch (error) {
      console.error("Duplicate exam failed:", error);
      alert(error instanceof Error ? error.message : "Couldn't duplicate exam.");
    }
  }

  async function handleToggleArchive(exam: Exam) {
    const nextStatus: ExamStatus = exam.status === "archived" ? "draft" : "archived";
    try {
      await updateExam(exam.id, { status: nextStatus });
      setExams((prev) =>
        prev.map((e) => (e.id === exam.id ? { ...e, status: nextStatus } : e))
      );
    } catch (error) {
      console.error("Archive exam failed:", error);
      alert(error instanceof Error ? error.message : "Couldn't archive/unarchive exam.");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this exam and its config permanently? Attempts are kept for records.")) return;
    try {
      await deleteExam(id);
      setExams((prev) => prev.filter((e) => e.id !== id));
    } catch (error) {
      console.error("Delete exam failed:", error);
      alert(error instanceof Error ? error.message : "Couldn't delete exam.");
    }
  }

  function handleAssignDone(patch: { assignedAgentIds: string[]; status: ExamStatus }) {
    if (assigning) {
      setExams((prev) =>
        prev.map((e) => (e.id === assigning.id ? { ...e, ...patch } : e))
      );
    }
    setAssigning(null);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Exams</h1>
        <Link href="/auditor/exams/create" className="btn-primary">
          <Plus className="mr-1.5 h-4 w-4" /> Create exam
        </Link>
      </div>

      <div className="card mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search exams by name or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="input w-auto"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ExamStatus | "")}
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
          <select
            className="input w-auto"
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value as ExamMode | "")}
          >
            <option value="">All modes</option>
            <option value="normal">Normal</option>
            <option value="until_perfect">Until Perfect 10</option>
          </select>
          {(search || activeFilterCount > 0) && (
            <button className="btn-secondary text-xs" onClick={clearFilters} title="Clear filters">
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>

        {!loading && (
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>
              Showing <strong className="text-slate-700 dark:text-slate-200">{filteredExams.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filteredExams.length)}</strong> of <strong className="text-slate-700 dark:text-slate-200">{filteredExams.length}</strong> matching exams
            </span>
            <span>{exams.length} total exams</span>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading exams...</p>
      ) : filteredExams.length === 0 ? (
        <EmptyState
          title="No exams found"
          subtitle={exams.length === 0 ? "Create your first exam from the question bank." : "Try clearing or broadening your search filters."}
        />
      ) : (
        <div className="space-y-2">
          {visibleExams.map((exam) => (
            <div key={exam.id} className="card flex items-center justify-between gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Link href={`/auditor/exams/${exam.id}`} className="font-medium hover:underline">
                    {exam.name}
                  </Link>
                  <Badge color={STATUS_COLOR[exam.status]}>{exam.status}</Badge>
                  <Badge>{exam.mode === "until_perfect" ? "Until Perfect 10" : "Normal"}</Badge>
                </div>
                <p className="truncate text-sm text-slate-500">{exam.description || "No description provided."}</p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                  <span>{exam.questions.length} question(s)</span>
                  <span>·</span>
                  <span>{exam.assignedAgentIds.length} agent(s) assigned</span>
                  <span>·</span>
                  <Link href={`/auditor/exams/${exam.id}/results`} className="text-brand-600 hover:underline">
                    Results
                  </Link>
                  <span>·</span>
                  <Link href={`/auditor/exams/${exam.id}/review`} className="text-brand-600 hover:underline">
                    Review
                  </Link>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  className="btn-secondary px-2 py-1"
                  onClick={() => setAssigning(exam)}
                  title="Assign agents"
                >
                  <Users className="h-4 w-4" />
                </button>
                <button
                  className="btn-secondary px-2 py-1"
                  onClick={() => handleDuplicate(exam.id)}
                  title="Duplicate exam"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <button
                  className="btn-secondary px-2 py-1"
                  onClick={() => handleToggleArchive(exam)}
                  title={exam.status === "archived" ? "Unarchive exam" : "Archive exam"}
                >
                  {exam.status === "archived" ? (
                    <ArchiveRestore className="h-4 w-4 text-brand-600" />
                  ) : (
                    <Archive className="h-4 w-4 text-slate-500" />
                  )}
                </button>
                <button
                  className="btn-secondary px-2 py-1 text-red-500"
                  onClick={() => handleDelete(exam.id)}
                  title="Delete exam"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          {totalPages > 1 && (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
              <button
                className="btn-secondary text-xs"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <span className="text-xs text-slate-500">
                Page {currentPage} of {totalPages}
              </span>
              <button
                className="btn-secondary text-xs"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      <Modal open={!!assigning} onClose={() => setAssigning(null)} title={`Assign agents — ${assigning?.name ?? ""}`}>
        {assigning && (
          <AssignAgentsModal
            exam={assigning}
            onDone={handleAssignDone}
          />
        )}
      </Modal>
    </div>
  );
}
