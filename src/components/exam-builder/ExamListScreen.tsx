"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import { fetchExams, duplicateExam, updateExam, deleteExam, populateExamQuestionSnapshots } from "@/lib/exams";
import type { Exam, ExamStatus } from "@/types";
import { Badge, EmptyState, Modal } from "@/components/ui/Primitives";
import { useAuth } from "@/context/AuthContext";
import {
  Copy,
  Trash2,
  Users,
  Plus,
  Pencil,
  BookOpen,
  Calendar,
  ChevronDown,
  ChevronUp,
  Search,
  RefreshCw,
} from "lucide-react";
import { AssignAgentsModal } from "./AssignAgentsModal";

const STATUS_COLOR: Record<ExamStatus, "slate" | "brand" | "green" | "amber" | "red"> = {
  draft: "slate",
  published: "brand",
  active: "amber",
  completed: "green",
  archived: "red",
};

export type ExamModuleCategory = "Revenue Cycle Management" | "Patient Engagement";

interface ModuleConfig {
  id: ExamModuleCategory;
  name: string;
  code: string;
  description: string;
}

const MODULES: ModuleConfig[] = [
  {
    id: "Revenue Cycle Management",
    name: "Revenue Cycle Management",
    code: "RCM",
    description: "Billing, insurance verification, claims processing, and financial workflows.",
  },
  {
    id: "Patient Engagement",
    name: "Patient Engagement",
    code: "Pt. Eng",
    description: "Scheduling, front-desk communication, patient intake, and service workflows.",
  },
];

/**
 * Safely categorizes an exam based on existing naming conventions without modifying Firestore documents.
 * Any exam matching "P.E", "Pt. Eng", or "Patient Engagement" maps to Patient Engagement;
 * all other exams map to Revenue Cycle Management.
 */
export function categorizeExam(exam: Exam): ExamModuleCategory {
  if (exam.category) {
    if (exam.category === "Patient Engagement") return "Patient Engagement";
    return "Revenue Cycle Management";
  }
  const name = (exam.name || "").toLowerCase();
  const desc = (exam.description || "").toLowerCase();

  const isPE =
    name.includes("p.e") ||
    name.includes("pe |") ||
    name.includes("| pe") ||
    name.includes("patient engagement") ||
    name.includes("pt. eng") ||
    name.includes("pt eng") ||
    /\bpe\b/i.test(name) ||
    desc.includes("patient engagement");

  return isPE ? "Patient Engagement" : "Revenue Cycle Management";
}

/**
 * Derives a clean display title (e.g. "Test 1", "Test 2") for legacy exams with pipe syntax,
 * while preserving auditor-created clean names as-is.
 */
export function deriveCleanTitle(exam: Exam, indexInModule: number): { title: string; isLegacy: boolean } {
  const raw = (exam.name || "").trim() || "Untitled Exam";
  const isPipe = raw.includes("|");
  const startsWithCode = /^[A-Z0-9_-]+\s*\|/i.test(raw) || /^PS\d+/i.test(raw);

  if (!isPipe && !startsWithCode) {
    return { title: raw, isLegacy: false };
  }

  // Check for explicit "Test <number>" in the legacy name
  const testMatch = raw.match(/\bTest\s*(\d+)\b/i);
  if (testMatch) {
    return { title: `Test ${parseInt(testMatch[1], 10)}`, isLegacy: true };
  }

  // Check for "Day <number>"
  const dayMatch = raw.match(/\bDay\s*(\d+)\b/i);
  if (dayMatch) {
    return { title: `Test ${parseInt(dayMatch[1], 10)}`, isLegacy: true };
  }

  // Check for "Assessment/Quiz/Exam <number>"
  const assessMatch = raw.match(/\b(?:Assessment|Quiz|Exam)\s*(\d+)\b/i);
  if (assessMatch) {
    return { title: `Test ${parseInt(assessMatch[1], 10)}`, isLegacy: true };
  }

  // Check for a descriptive trailing segment after the last pipe
  const segments = raw.split("|").map((s) => s.trim()).filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  if (
    lastSegment &&
    !/^(p\.?e\.?|rcm|patient engagement|revenue cycle management)$/i.test(lastSegment) &&
    !/^[A-Z0-9_-]+$/i.test(lastSegment)
  ) {
    return { title: `Test ${indexInModule + 1} · ${lastSegment}`, isLegacy: true };
  }

  return { title: `Test ${indexInModule + 1}`, isLegacy: true };
}

function formatExamDate(exam: Exam): string {
  if (exam.examDate) {
    const parts = exam.examDate.split("-");
    if (parts.length === 3) {
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
      }
    }
    return exam.examDate;
  }
  if (!exam.createdAt) return "Date unavailable";
  return new Date(exam.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatStatus(status: ExamStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "published":
      return "Published";
    case "active":
      return "Active";
    case "completed":
      return "Completed";
    case "archived":
      return "Archived";
    default:
      return status;
  }
}

export function ExamListScreen() {
  const { profile } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<Exam | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedModules, setCollapsedModules] = useState<Record<string, boolean>>({});

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

  const [regeneratingExamId, setRegeneratingExamId] = useState<string | null>(null);
  const healingExamIdsRef = useRef<Set<string>>(new Set());

  // Automatically backfill safe question snapshots for any published/active legacy exams missing them
  useEffect(() => {
    if (!profile || profile.role !== "auditor" || exams.length === 0) return;
    const legacyExams = exams.filter(
      (e) =>
        (e.status === "published" || e.status === "active") &&
        e.questions.length > 0 &&
        (!e.questionSnapshots || Object.keys(e.questionSnapshots).length < e.questions.length) &&
        !healingExamIdsRef.current.has(e.id)
    );
    if (legacyExams.length === 0) return;

    let active = true;
    (async () => {
      for (const exam of legacyExams) {
        healingExamIdsRef.current.add(exam.id);
        try {
          const healed = await populateExamQuestionSnapshots(exam);
          if (active && healed) {
            setExams((prev) =>
              prev.map((item) => (item.id === exam.id ? { ...item, questionSnapshots: healed } : item))
            );
          }
        } catch (err) {
          console.warn(`Could not auto-heal question snapshots for exam ${exam.id}:`, err);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [exams, profile]);

  async function handleRegenerateSnapshots(exam: Exam) {
    setRegeneratingExamId(exam.id);
    try {
      const healed = await populateExamQuestionSnapshots(exam);
      if (healed) {
        setExams((prev) =>
          prev.map((item) => (item.id === exam.id ? { ...item, questionSnapshots: healed } : item))
        );
      }
    } catch (err) {
      console.error("Failed to regenerate snapshots:", err);
      alert(err instanceof Error ? err.message : "Failed to regenerate snapshots.");
    } finally {
      setRegeneratingExamId(null);
    }
  }

  async function handleDuplicate(id: string) {
    if (!profile) return;
    try {
      const copy = await duplicateExam(id, profile.uid);
      setExams((prev) => [copy, ...prev]);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Couldn't duplicate exam.");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this exam and its config permanently? Attempts are kept for records.")) return;
    try {
      await deleteExam(id);
      setExams((prev) => prev.filter((e) => e.id !== id));
    } catch (error) {
      alert(error instanceof Error ? error.message : "Couldn't delete exam.");
    }
  }

  function toggleCollapse(moduleId: string) {
    setCollapsedModules((prev) => ({
      ...prev,
      [moduleId]: !prev[moduleId],
    }));
  }

  // Filter exams by search query
  const filteredExams = useMemo(() => {
    if (!searchQuery.trim()) return exams;
    const q = searchQuery.toLowerCase().trim();
    return exams.filter(
      (e) => e.name.toLowerCase().includes(q) || (e.description && e.description.toLowerCase().includes(q))
    );
  }, [exams, searchQuery]);

  // Group exams by UI module
  const groupedExams = useMemo(() => {
    const rcm: Exam[] = [];
    const pe: Exam[] = [];

    filteredExams.forEach((exam) => {
      if (categorizeExam(exam) === "Patient Engagement") {
        pe.push(exam);
      } else {
        rcm.push(exam);
      }
    });

    // Sort chronologically within each module to ensure stable "Test 1, Test 2, ..." numbering
    rcm.sort((a, b) => a.createdAt - b.createdAt);
    pe.sort((a, b) => a.createdAt - b.createdAt);

    return {
      "Revenue Cycle Management": rcm,
      "Patient Engagement": pe,
    };
  }, [filteredExams]);

  const totalAssignedAgents = useMemo(() => {
    const uniqueUids = new Set<string>();
    exams.forEach((e) => (e.assignedAgentIds || []).forEach((uid) => uniqueUids.add(uid)));
    return uniqueUids.size;
  }, [exams]);

  return (
    <div className="space-y-6">
      {/* Workspace Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Exams</h1>
            <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
              Beta Workspace
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Structured module-based assessment catalogue and exam management.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/auditor/exams/create" className="btn-primary">
            <Plus className="mr-1.5 h-4 w-4" /> Create Exam
          </Link>
        </div>
      </div>

      {/* Operational Overview Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Total Exams</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{exams.length}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">RCM Tests</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
            {groupedExams["Revenue Cycle Management"].length}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Pt. Eng Tests</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
            {groupedExams["Patient Engagement"].length}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-400">Assigned Agents</p>
          <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{totalAssignedAgents}</p>
        </div>
      </div>

      {/* Search / Filter Bar */}
      {exams.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            className="input pl-10"
            placeholder="Search exams by title, topic, or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      )}

      {loading ? (
        <div className="card p-12 text-center text-sm text-slate-400">Loading exams workspace...</div>
      ) : exams.length === 0 ? (
        <EmptyState title="No exams yet" subtitle="Create your first exam from the question bank to get started." />
      ) : (
        /* Module Grouping Sections */
        <div className="space-y-6">
          {MODULES.map((module) => {
            const moduleExams = groupedExams[module.id];
            const isCollapsed = collapsedModules[module.id] ?? false;

            return (
              <div
                key={module.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900/70"
              >
                {/* Module Header Container */}
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40 sm:p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm font-bold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                      {module.code}
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{module.name}</h2>
                        <Badge color="slate">
                          {moduleExams.length} {moduleExams.length === 1 ? "Test" : "Tests"}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{module.description}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleCollapse(module.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    title={isCollapsed ? "Expand module" : "Collapse module"}
                    aria-label={isCollapsed ? "Expand module" : "Collapse module"}
                  >
                    {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  </button>
                </div>

                {/* Module Tests Body */}
                {!isCollapsed && (
                  <div className="p-4 sm:p-5">
                    {moduleExams.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400 dark:border-slate-800">
                        {searchQuery
                          ? `No tests matching "${searchQuery}" in this module.`
                          : "No tests created under this module yet."}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {moduleExams.map((exam, index) => {
                          const { title: cleanTitle, isLegacy } = deriveCleanTitle(exam, index);

                          return (
                            <div
                              key={exam.id}
                              className="rounded-xl border border-slate-200/80 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm dark:border-slate-800/80 dark:bg-slate-800/20 dark:hover:border-slate-700"
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0 flex-1">
                                  {/* Title & Badges */}
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Link
                                      href={`/auditor/exams/${exam.id}`}
                                      className="text-base font-semibold text-slate-900 transition hover:text-brand-700 hover:underline dark:text-slate-100 dark:hover:text-brand-300"
                                    >
                                      {cleanTitle}
                                    </Link>
                                    <Badge color={STATUS_COLOR[exam.status]}>{formatStatus(exam.status)}</Badge>
                                    <Badge color={exam.mode === "until_perfect" ? "amber" : "slate"}>
                                      {exam.mode === "until_perfect" ? "Until Perfect 10" : "Normal"}
                                    </Badge>
                                  </div>

                                  {/* Legacy Reference Subtitle (preserves original identification) */}
                                  {isLegacy && (
                                    <p className="mt-0.5 truncate font-mono text-xs text-slate-400" title={exam.name}>
                                      Original: {exam.name}
                                    </p>
                                  )}

                                  {/* Description if present */}
                                  {exam.description && (
                                    <p className="mt-1 line-clamp-1 text-sm text-slate-500 dark:text-slate-400">
                                      {exam.description}
                                    </p>
                                  )}

                                  {/* Metadata Row */}
                                  <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1">
                                      <BookOpen className="h-3.5 w-3.5 text-slate-400" />
                                      {exam.questions.length} {exam.questions.length === 1 ? "question" : "questions"}
                                    </span>
                                    <span className="flex items-center gap-1">
                                      <Users className="h-3.5 w-3.5 text-slate-400" />
                                      {(exam.assignedAgentIds || []).length}{" "}
                                      {(exam.assignedAgentIds || []).length === 1 ? "agent" : "agents"} assigned
                                    </span>
                                    <span className="flex items-center gap-1">
                                      <Calendar className="h-3.5 w-3.5 text-slate-400" />
                                      {formatExamDate(exam)}
                                    </span>
                                  </div>
                                </div>

                                {/* Existing Actions */}
                                <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-center">
                                  {exam.questions.length > 0 &&
                                    (!exam.questionSnapshots ||
                                      Object.keys(exam.questionSnapshots).length < exam.questions.length) && (
                                      <button
                                        type="button"
                                        className="btn-secondary flex items-center gap-1 border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                                        onClick={() => handleRegenerateSnapshots(exam)}
                                        disabled={regeneratingExamId === exam.id}
                                        title="Safe question snapshots are missing for agents. Click to generate safe content."
                                      >
                                        <RefreshCw
                                          className={`h-3.5 w-3.5 ${regeneratingExamId === exam.id ? "animate-spin" : ""}`}
                                        />
                                        {regeneratingExamId === exam.id ? "Publishing..." : "Publish Safe Content"}
                                      </button>
                                    )}

                                  <Link
                                    href={`/auditor/exams/${exam.id}`}
                                    className="btn-secondary px-3 py-1.5 text-xs"
                                    title="Open and edit exam"
                                  >
                                    <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                                  </Link>

                                  <button
                                    type="button"
                                    className="btn-secondary px-2.5 py-1.5 text-xs"
                                    onClick={() => setAssigning(exam)}
                                    title="Assign agents"
                                    aria-label="Assign agents"
                                  >
                                    <Users className="h-3.5 w-3.5" />
                                  </button>

                                  <button
                                    type="button"
                                    className="btn-secondary px-2.5 py-1.5 text-xs"
                                    onClick={() => handleDuplicate(exam.id)}
                                    title="Duplicate exam"
                                    aria-label="Duplicate exam"
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </button>

                                  <button
                                    type="button"
                                    className="btn-secondary px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
                                    onClick={() => handleDelete(exam.id)}
                                    title="Delete exam"
                                    aria-label="Delete exam"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Agent Assignment & Reassignment Modal */}
      <Modal
        open={!!assigning}
        onClose={() => setAssigning(null)}
        title={`Assign or Reassign Agents — ${assigning?.name ?? ""}`}
        wide
      >
        {assigning && (
          <AssignAgentsModal
            exam={assigning}
            onClose={() => setAssigning(null)}
            onDone={(patch) => {
              setExams((prev) => prev.map((e) => (e.id === assigning.id ? { ...e, ...patch } : e)));
              setAssigning(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

