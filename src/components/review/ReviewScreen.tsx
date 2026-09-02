"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchExams } from "@/lib/exams";
import {
  fetchAttemptsForExam,
  saveReviewDraft,
  finalizeReview,
  archiveAttempt,
  unarchiveAttempt,
  reassignWrongAnswers,
} from "@/lib/attempts";
import { getQuestionsByIds } from "@/lib/questions";
import { fetchAllUsers } from "@/lib/users";
import { useAuth } from "@/context/AuthContext";
import type {
  Exam,
  ExamAttempt,
  AttemptStatus,
  Question,
  AppUser,
  KnowledgeGapCategory,
  AttemptAnswer,
  ScoreHistoryEntry,
} from "@/types";
import { AnswerDisplay } from "@/components/questions/AnswerDisplay";
import { Badge, EmptyState, Modal, MarkdownRenderer } from "@/components/ui/Primitives";
import {
  ChevronDown,
  ChevronRight,
  History,
  Save,
  CheckCircle2,
  AlertTriangle,
  Search,
  RotateCcw,
  Archive,
  ArchiveRestore,
  Users,
} from "lucide-react";

const KNOWLEDGE_GAPS: KnowledgeGapCategory[] = [
  "Product Knowledge",
  "Workflow",
  "Navigation",
  "Troubleshooting",
  "Insurance",
  "Reporting",
  "Clinical",
  "Scheduler",
  "Communication",
  "Compliance",
  "Other",
];

const DEFAULT_COMMENT_TEMPLATES = [
  "Full credit: Comprehensive explanation covering all critical points.",
  "Partial credit: Correct core concept but missed key edge-case handling.",
  "Partial credit: Missing secondary workflow requirement.",
  "Incorrect: Misidentified primary procedure or navigation path.",
  "Incomplete answer: Please review standard operating procedure documentation.",
  "Good attempt: Follow standard naming conventions and step sequences.",
  "Accurate analysis: Well-structured solution addressing all aspects.",
];

const STORAGE_KEY_TEMPLATES = "qa_auditor_comment_templates";

function getStoredTemplates(): string[] {
  if (typeof window === "undefined") return DEFAULT_COMMENT_TEMPLATES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_TEMPLATES);
    if (!raw) return DEFAULT_COMMENT_TEMPLATES;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return DEFAULT_COMMENT_TEMPLATES;
}

function saveCustomTemplate(template: string): string[] {
  const current = getStoredTemplates();
  if (current.includes(template)) return current;
  const next = [...current, template];
  try {
    localStorage.setItem(STORAGE_KEY_TEMPLATES, JSON.stringify(next));
  } catch {}
  return next;
}

const PAGE_SIZE = 25;

export function ReviewScreen() {
  const { profile } = useAuth();

  const [exams, setExams] = useState<Exam[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [selectedExam, setSelectedExam] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("");
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [questionCache, setQuestionCache] = useState<
    Record<string, Question>
  >({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AttemptStatus | "pending" | "">("pending");
  const [archiveFilter, setArchiveFilter] = useState<"active" | "archived" | "all">("active");
  const [currentPage, setCurrentPage] = useState(1);

  const [finalizingId, setFinalizingId] = useState<string | null>(
    null
  );
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const examMap = useMemo(
    () => new Map(exams.map((e) => [e.id, e])),
    [exams]
  );

  async function loadAllData() {
    try {
      setLoading(true);
      const [examList, userList] = await Promise.all([
        fetchExams(),
        fetchAllUsers(),
      ]);
      setExams(examList);
      setUsers(userList);

      const allList = (
        await Promise.all(
          examList.map((exam) => fetchAttemptsForExam(exam.id))
        )
      ).flat();

      setAttempts(allList);

      const ids = Array.from(
        new Set(allList.flatMap((a) => a.answers.map((ans) => ans.questionId)))
      );
      if (ids.length) {
        const fetched = await getQuestionsByIds(ids);
        const cache: Record<string, Question> = {};
        fetched.forEach((q) => {
          if (q) cache[q.id] = q;
        });
        setQuestionCache(cache);
      }
    } catch (err) {
      console.error("Failed to load review queue:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAllData();
  }, []);

  function handleSavedAttempt(updated: ExamAttempt) {
    setAttempts((prev) =>
      prev.map((a) => (a.id === updated.id ? updated : a))
    );
  }

  function userName(uid: string) {
    return (
      users.find((u) => u.uid === uid)?.name ??
      uid.slice(0, 8)
    );
  }

  function userEmail(uid: string) {
    return users.find((u) => u.uid === uid)?.email ?? "";
  }

  async function handleFinalize(attempt: ExamAttempt) {
    if (!profile) return;

    const unscored = attempt.answers.filter(
      (a) => a.marks === undefined
    );

    if (unscored.length > 0) {
      setMessage({
        type: "error",
        text: `${unscored.length} question(s) still need to be reviewed.`,
      });
      return;
    }

    const confirmed = window.confirm(
      `Submit review for ${userName(
        attempt.agentId
      )} - Attempt #${attempt.attemptNumber}?\n\nOnce submitted, this attempt will become an official reviewed attempt.`
    );

    if (!confirmed) return;

    try {
      setFinalizingId(attempt.id);
      setMessage(null);

      const finalized = await finalizeReview(
        attempt.id,
        profile.uid
      );

      setMessage({
        type: "success",
        text: `Review submitted successfully. Final score: ${
          finalized.totalMarks ?? 0
        }/${finalized.maxTotalMarks ?? 0}.`,
      });

      handleSavedAttempt(finalized);
    } catch (error) {
      console.error(error);

      setMessage({
        type: "error",
        text:
          error instanceof Error
            ? error.message
            : "Unable to submit review.",
      });
    } finally {
      setFinalizingId(null);
    }
  }

  const filteredAttempts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return attempts
      .filter((attempt) => {
        if (selectedExam && attempt.examId !== selectedExam) return false;
        if (selectedAgent && attempt.agentId !== selectedAgent) return false;

        if (statusFilter === "pending") {
          if (attempt.status !== "submitted" && attempt.status !== "review_in_progress") {
            return false;
          }
        } else if (statusFilter) {
          if (attempt.status !== statusFilter) return false;
        }

        if (archiveFilter === "active" && attempt.archived) return false;
        if (archiveFilter === "archived" && !attempt.archived) return false;

        if (q) {
          const name = userName(attempt.agentId).toLowerCase();
          const email = userEmail(attempt.agentId).toLowerCase();
          const examName = (examMap.get(attempt.examId)?.name ?? "").toLowerCase();
          const id = attempt.id.toLowerCase();
          if (
            !name.includes(q) &&
            !email.includes(q) &&
            !examName.includes(q) &&
            !id.includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => (a.submittedAt ?? a.startedAt) - (b.submittedAt ?? b.startedAt));
  }, [attempts, search, selectedExam, selectedAgent, statusFilter, archiveFilter, users, examMap]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedExam, selectedAgent, statusFilter, archiveFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredAttempts.length / PAGE_SIZE));
  const visibleAttempts = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredAttempts.slice(start, start + PAGE_SIZE);
  }, [filteredAttempts, currentPage]);

  const totalPendingCount = attempts.filter(
    (a) =>
      !a.archived &&
      (a.status === "submitted" || a.status === "review_in_progress")
  ).length;

  const examsWithPending = new Set(
    attempts
      .filter(
        (a) =>
          !a.archived &&
          (a.status === "submitted" || a.status === "review_in_progress")
      )
      .map((a) => a.examId)
  ).size;

  async function handleToggleArchiveAttempt(e: React.MouseEvent, attempt: ExamAttempt) {
    e.stopPropagation();
    const willArchive = !attempt.archived;
    const confirmed = window.confirm(
      willArchive
        ? `Archive attempt #${attempt.attemptNumber} for ${userName(attempt.agentId)}?\n\nThis will exclude this attempt from active competency and analytics without deleting its historical answers, marks, or remarks.`
        : `Restore attempt #${attempt.attemptNumber} for ${userName(attempt.agentId)} back to active status?`
    );
    if (!confirmed) return;

    try {
      if (willArchive) {
        await archiveAttempt(attempt.id);
      } else {
        await unarchiveAttempt(attempt.id);
      }
      setAttempts((prev) =>
        prev.map((a) =>
          a.id === attempt.id
            ? { ...a, archived: willArchive, archivedAt: Date.now() }
            : a
        )
      );
      setMessage({
        type: "success",
        text: willArchive
          ? "Attempt archived successfully (historical data preserved)."
          : "Attempt restored to active status.",
      });
    } catch (err) {
      console.error(err);
      setMessage({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "Failed to update attempt archive status.",
      });
    }
  }

  async function handleReassignWrong(attempt: ExamAttempt) {
    const examObj = examMap.get(attempt.examId);
    if (!examObj || !profile?.uid) return;
    const wrongCount = attempt.answers.filter((a) => (a.marks ?? 0) < a.maxMarks).length;
    const confirmed = window.confirm(
      `Reassign the ${wrongCount} imperfect question(s) to ${userName(attempt.agentId)} as a targeted retake attempt?`
    );
    if (!confirmed) return;

    try {
      await reassignWrongAnswers(attempt, examObj, profile.uid);
      setMessage({
        type: "success",
        text: `Targeted retake attempt created successfully for ${userName(attempt.agentId)}.`,
      });
      loadAllData();
    } catch (err) {
      console.error(err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to create retake attempt.",
      });
    }
  }

  async function handleBulkApplySameAnswer(
    questionId: string,
    rawAgentAnswer: string,
    marks: number,
    comments: string,
    knowledgeGap?: KnowledgeGapCategory,
    sourceExamId?: string
  ) {
    if (!profile?.uid) return;
    const norm = (rawAgentAnswer || "").trim().toLowerCase();
    const targets = attempts.filter((att) => {
      if (sourceExamId && att.examId !== sourceExamId) return false;
      if (att.status !== "submitted" && att.status !== "review_in_progress") return false;
      const ans = att.answers.find((a) => a.questionId === questionId);
      if (!ans) return false;
      return (ans.agentAnswer || "").trim().toLowerCase() === norm;
    });

    if (targets.length === 0) return;

    const confirmed = window.confirm(
      `Apply this score (${marks} marks) and feedback to ${targets.length} candidate(s) who provided the exact same answer to this question?`
    );
    if (!confirmed) return;

    try {
      const results = await Promise.all(
        targets.map((att) =>
          saveReviewDraft(
            att,
            questionId,
            marks,
            comments,
            profile.uid,
            knowledgeGap,
            "Bulk applied score to identical answer"
          )
        )
      );

      setAttempts((prev) => {
        const next = [...prev];
        results.forEach((updated) => {
          const idx = next.findIndex((a) => a.id === updated.id);
          if (idx !== -1) next[idx] = updated;
        });
        return next;
      });

      setMessage({
        type: "success",
        text: `Successfully applied score and comments to ${targets.length} candidate attempt(s).`,
      });
    } catch (err) {
      console.error(err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to bulk apply score.",
      });
    }
  }

  /* ---------------------------------------------------------
     BULK REASSIGN WRONG ANSWERS BELOW THRESHOLD
     --------------------------------------------------------- */
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkExamId, setBulkExamId] = useState("");
  const [bulkThreshold, setBulkThreshold] = useState(70);
  const [bulkRunning, setBulkRunning] = useState(false);

  const bulkQualifyingAttempts = useMemo(() => {
    if (!bulkExamId) return [];
    return attempts.filter((att) => {
      if (att.examId !== bulkExamId) return false;
      if (att.status !== "reviewed" || att.archived) return false;
      if (!att.maxTotalMarks) return false;
      const pct = Math.round(((att.totalMarks ?? 0) / att.maxTotalMarks) * 100);
      if (pct >= bulkThreshold) return false;
      const hasWrong = att.answers.some((a) => (a.marks ?? 0) < a.maxMarks);
      if (!hasWrong) return false;

      const hasActiveRetake = attempts.some(
        (other) =>
          other.agentId === att.agentId &&
          other.examId === bulkExamId &&
          other.isRetake &&
          (other.status === "in_progress" ||
            other.status === "submitted" ||
            other.status === "review_in_progress")
      );
      return !hasActiveRetake;
    });
  }, [attempts, bulkExamId, bulkThreshold]);

  async function executeBulkReassign() {
    if (!profile?.uid || !bulkExamId) return;
    const targetExam = examMap.get(bulkExamId);
    if (!targetExam) return;

    if (bulkQualifyingAttempts.length === 0) {
      alert(`No reviewed attempts found scoring below ${bulkThreshold}% without an existing active retake.`);
      return;
    }

    const confirmed = window.confirm(
      `Generate targeted retake attempts for ${bulkQualifyingAttempts.length} candidate(s) scoring below ${bulkThreshold}% on "${targetExam.name}"?`
    );
    if (!confirmed) return;

    try {
      setBulkRunning(true);
      let successCount = 0;
      for (const att of bulkQualifyingAttempts) {
        try {
          await reassignWrongAnswers(att, targetExam, profile.uid);
          successCount++;
        } catch (err) {
          console.error(`Failed reassign for attempt ${att.id}:`, err);
        }
      }

      setBulkModalOpen(false);
      setMessage({
        type: "success",
        text: `Bulk reassigned wrong answers: created ${successCount} targeted retake attempt(s).`,
      });
      loadAllData();
    } catch (err) {
      console.error(err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to bulk reassign retakes.",
      });
    } finally {
      setBulkRunning(false);
    }
  }

  function clearFilters() {
    setSearch("");
    setSelectedExam("");
    setSelectedAgent("");
    setStatusFilter("pending");
    setArchiveFilter("active");
    setCurrentPage(1);
  }

  return (
    <div>
      {/* HEADER & QUEUE COUNTER */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">
            Review Queue
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Work through submitted and pending attempts across all exams in oldest-first FIFO order.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {totalPendingCount > 0 ? (
            <Badge color="amber">
              {totalPendingCount} Pending ({examsWithPending} Exam{examsWithPending === 1 ? "" : "s"})
            </Badge>
          ) : (
            <Badge color="green">Queue Clear (All caught up!)</Badge>
          )}

          <button
            type="button"
            className="btn-secondary text-xs flex items-center gap-1.5"
            onClick={() => {
              setBulkExamId(selectedExam || (exams[0]?.id ?? ""));
              setBulkModalOpen(true);
            }}
            title="Bulk reassign wrong answers for agents below a score threshold"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Bulk Reassign Below Threshold...
          </button>
        </div>
      </div>

      {/* BULK REASSIGN MODAL */}
      <Modal
        open={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        title="Bulk Reassign Wrong Answers"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Automatically create targeted retake attempts for all agents who scored below your threshold on a reviewed exam.
          </p>

          <div>
            <label className="mb-1 block text-xs font-medium">Target Exam</label>
            <select
              className="input"
              value={bulkExamId}
              onChange={(e) => setBulkExamId(e.target.value)}
            >
              <option value="">Select an exam...</option>
              {exams.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">
              Score Threshold: Below {bulkThreshold}%
            </label>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={bulkThreshold}
              onChange={(e) => setBulkThreshold(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-slate-400">
              <span>10%</span>
              <span className="font-semibold text-slate-700 dark:text-slate-200">{bulkThreshold}%</span>
              <span>100% (Any imperfect)</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800">
            <p className="font-semibold">
              {bulkQualifyingAttempts.length} qualifying candidate attempt(s) found
            </p>
            <p className="mt-0.5 text-slate-500">
              Candidates who scored &lt; {bulkThreshold}% on this exam and do not already have an open retake in progress.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setBulkModalOpen(false)}
              disabled={bulkRunning}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary text-xs flex items-center gap-1.5"
              onClick={executeBulkReassign}
              disabled={bulkRunning || bulkQualifyingAttempts.length === 0 || !bulkExamId}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {bulkRunning
                ? "Reassigning..."
                : `Create ${bulkQualifyingAttempts.length} Retake(s)`}
            </button>
          </div>
        </div>
      </Modal>

      {/* FILTER BAR */}
      <div className="card mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search agent, email, exam, ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="input"
            value={selectedExam}
            onChange={(e) => setSelectedExam(e.target.value)}
          >
            <option value="">All Exams</option>
            {exams.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>

          <select
            className="input"
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
          >
            <option value="">All Agents</option>
            {users
              .filter((u) => u.role === "agent")
              .map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.name}
                </option>
              ))}
          </select>

          <select
            className="input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="pending">Pending Reviews (Queue)</option>
            <option value="submitted">Needs Review</option>
            <option value="review_in_progress">Under Review</option>
            <option value="reviewed">Reviewed</option>
            <option value="">All Statuses</option>
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span>
              Showing{" "}
              <strong className="text-slate-700 dark:text-slate-200">
                {filteredAttempts.length === 0
                  ? 0
                  : (currentPage - 1) * PAGE_SIZE + 1}
                –{Math.min(currentPage * PAGE_SIZE, filteredAttempts.length)}
              </strong>{" "}
              of{" "}
              <strong className="text-slate-700 dark:text-slate-200">
                {filteredAttempts.length}
              </strong>{" "}
              queue items
            </span>

            <select
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800"
              value={archiveFilter}
              onChange={(e) => setArchiveFilter(e.target.value as any)}
            >
              <option value="active">Active attempts</option>
              <option value="archived">Archived attempts</option>
              <option value="all">All (active & archived)</option>
            </select>
          </div>

          {(search || selectedExam || selectedAgent || statusFilter !== "pending" || archiveFilter !== "active") && (
            <button
              className="btn-secondary text-xs flex items-center gap-1"
              onClick={clearFilters}
              title="Reset all filters"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset Filters
            </button>
          )}
        </div>
      </div>

      {message && (
        <div
          className={`mb-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}

          <span>{message.text}</span>
        </div>
      )}

      {loading ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-slate-400">Loading review queue...</p>
        </div>
      ) : filteredAttempts.length === 0 ? (
        <EmptyState
          title={
            statusFilter === "pending"
              ? "All caught up!"
              : attempts.length === 0
              ? "No attempts submitted yet"
              : "No matching attempts"
          }
          subtitle={
            statusFilter === "pending"
              ? "No pending attempts require review matching current filters. Select 'Reviewed' or 'All Statuses' to inspect historical submissions."
              : attempts.length === 0
              ? "When agents submit exams, their attempts will appear in this queue automatically."
              : "Try broadening or resetting your search filters."
          }
        />
      ) : (
        <div className="space-y-2">
          {visibleAttempts.map((attempt) => {
            const reviewedCount = attempt.answers.filter(
              (a) => a.marks !== undefined
            ).length;

            const allReviewed =
              reviewedCount === attempt.answers.length;

            const draftTotal = attempt.answers.reduce(
              (sum, a) => sum + (a.marks ?? 0),
              0
            );

            const maxTotal = attempt.answers.reduce(
              (sum, a) => sum + a.maxMarks,
              0
            );

            return (
              <div
                key={attempt.id}
                className="card overflow-hidden"
              >
                <button
                  className="flex w-full items-center justify-between gap-4 p-4 text-left"
                  onClick={() =>
                    setExpanded(
                      expanded === attempt.id
                        ? null
                        : attempt.id
                    )
                  }
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {expanded === attempt.id ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          {userName(attempt.agentId)}
                        </p>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          {examMap.get(attempt.examId)?.name ?? "Exam"}
                        </span>
                        <Badge color="slate">#{attempt.attemptNumber}</Badge>
                        {attempt.isRetake && (
                          <Badge color="amber">Retake (wrong answers only)</Badge>
                        )}
                        {attempt.archived && (
                          <Badge color="red">Archived</Badge>
                        )}
                      </div>

                      <p className="mt-0.5 text-xs text-slate-500">
                        {userEmail(attempt.agentId) ? `${userEmail(attempt.agentId)} · ` : ""}
                        {attempt.timeTakenSeconds
                          ? `${Math.round(
                              attempt.timeTakenSeconds / 60
                            )} min · `
                          : ""}
                        Submitted{" "}
                        {new Date(
                          attempt.submittedAt ?? attempt.startedAt
                        ).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {attempt.status !== "reviewed" &&
                      reviewedCount > 0 && (
                        <Badge color="brand">
                          {reviewedCount}/
                          {attempt.answers.length} reviewed
                        </Badge>
                      )}

                    {attempt.status === "reviewed" &&
                    attempt.maxTotalMarks ? (
                      <Badge
                        color={
                          attempt.totalMarks ===
                          attempt.maxTotalMarks
                            ? "green"
                            : "brand"
                        }
                      >
                        {attempt.totalMarks}/
                        {attempt.maxTotalMarks}
                      </Badge>
                    ) : (
                      <Badge
                        color={
                          attempt.status === "submitted"
                            ? "amber"
                            : attempt.status ===
                              "review_in_progress"
                            ? "brand"
                            : "slate"
                        }
                      >
                        {formatStatus(attempt.status)}
                      </Badge>
                    )}

                    <button
                      className="btn-secondary px-2 py-1 text-xs"
                      onClick={(e) => handleToggleArchiveAttempt(e, attempt)}
                      title={attempt.archived ? "Restore attempt to active" : "Archive attempt (exclude from analytics)"}
                    >
                      {attempt.archived ? (
                        <span className="flex items-center gap-1 text-brand-600">
                          <ArchiveRestore className="h-3.5 w-3.5" /> Restore
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-slate-500">
                          <Archive className="h-3.5 w-3.5" /> Archive
                        </span>
                      )}
                    </button>
                  </div>
                </button>

                {expanded === attempt.id && (
                  <div className="border-t border-slate-100 p-4 dark:border-slate-700">
                    {attempt.status !== "reviewed" && (
                      <div className="mb-5 rounded-xl bg-slate-50 p-4 dark:bg-slate-800">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="font-medium">
                              Review Progress
                            </p>

                            <p className="mt-1 text-sm text-slate-500">
                              {reviewedCount} of{" "}
                              {attempt.answers.length} questions
                              reviewed
                            </p>
                          </div>

                          <div className="text-right">
                            <p className="text-xs uppercase tracking-wide text-slate-500">
                              Current Draft Score
                            </p>

                            <p className="text-lg font-semibold">
                              {draftTotal}/{maxTotal}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                          <div
                            className="h-full bg-blue-600 transition-all"
                            style={{
                              width: `${
                                attempt.answers.length
                                  ? (reviewedCount /
                                      attempt.answers.length) *
                                    100
                                  : 0
                              }%`,
                            }}
                          />
                        </div>

                        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                          <span>
                            ⚡ <strong>Keyboard Flow:</strong> Press <kbd className="rounded bg-slate-200 px-1 py-0.5 text-slate-800 dark:bg-slate-700 dark:text-slate-200 font-mono text-[10px]">Enter</kbd> in score input to save &amp; advance to next question.
                          </span>
                          <span>
                            <kbd className="rounded bg-slate-200 px-1 py-0.5 text-slate-800 dark:bg-slate-700 dark:text-slate-200 font-mono text-[10px]">Alt + ↑ / ↓</kbd> to jump between questions.
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="space-y-4">
                      {attempt.answers.map((ans, index) => {
                        // The snapshot frozen on this attempt is
                        // deliberately redacted (no expectedAnswer/
                        // correctOptionIndex) so agents can't read
                        // answer keys through their own attempt document.
                        // Merge the live, auditor-only question cache's
                        // real answer key back in for the grading
                        // reference, while keeping the frozen historical
                        // question text/options/type. Older attempts
                        // without a snapshot fall back to the live cache
                        // entirely.
                        const live = questionCache[ans.questionId];
                        const q = ans.questionSnapshot
                          ? {
                              ...ans.questionSnapshot,
                              expectedAnswer:
                                live?.expectedAnswer ??
                                ans.questionSnapshot.expectedAnswer,
                              correctOptionIndex:
                                live?.correctOptionIndex ??
                                ans.questionSnapshot.correctOptionIndex,
                            }
                          : live;

                        if (!q) return null;

                        return (
                          <QuestionScoreRow
                            key={ans.questionId}
                            number={index + 1}
                            question={q}
                            answer={ans}
                            attempt={attempt}
                            allAttempts={attempts}
                            reviewerId={profile?.uid ?? ""}
                            disabled={
                              attempt.status === "reviewed"
                            }
                            onSaved={handleSavedAttempt}
                            onBulkApplySameAnswer={handleBulkApplySameAnswer}
                          />
                        );
                      })}
                    </div>

                    {attempt.status !== "reviewed" && (
                      <div className="sticky bottom-3 mt-5 rounded-xl border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                        <div className="flex flex-wrap items-center justify-between gap-4">
                          <div>
                            <p className="font-semibold">
                              Finalize Review
                            </p>

                            <p className="text-sm text-slate-500">
                              {allReviewed
                                ? `All questions reviewed. Draft score: ${draftTotal}/${maxTotal}.`
                                : `${
                                    attempt.answers.length -
                                    reviewedCount
                                  } question(s) still need marks.`}
                            </p>
                          </div>

                          <button
                            className="btn-primary flex items-center gap-2"
                            disabled={
                              !allReviewed ||
                              finalizingId === attempt.id
                            }
                            onClick={() =>
                              handleFinalize(attempt)
                            }
                          >
                            <CheckCircle2 className="h-4 w-4" />

                            {finalizingId === attempt.id
                              ? "Submitting..."
                              : "Submit Review"}
                          </button>
                        </div>
                      </div>
                    )}

                    {attempt.status === "reviewed" && (
                      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-5 w-5 text-green-600" />

                          <div>
                            <p className="font-semibold text-green-800 dark:text-green-300">
                              Review Completed
                            </p>

                            <p className="text-sm text-green-700 dark:text-green-400">
                              Final Score:{" "}
                              {attempt.totalMarks ?? 0}/
                              {attempt.maxTotalMarks ?? 0}
                              {attempt.reviewedAt
                                ? ` · ${new Date(
                                    attempt.reviewedAt
                                  ).toLocaleString()}`
                                : ""}
                            </p>
                          </div>
                        </div>

                        {attempt.maxTotalMarks &&
                          (attempt.totalMarks ?? 0) < attempt.maxTotalMarks && (
                            <button
                              type="button"
                              className="btn-secondary text-xs flex items-center gap-1.5"
                              onClick={() => handleReassignWrong(attempt)}
                              title="Reassign imperfect answers as a targeted retake attempt"
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Reassign Wrong Answers (Retake)
                            </button>
                          )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

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
    </div>
  );
}

function computeRubricSuggestion(
  agentAnswer: string,
  expectedAnswer: string,
  maxMarks: number
): { scorePct: number; suggestedMarks: number; confidence: "high" | "medium" | "low" } | null {
  if (!agentAnswer || !expectedAnswer || maxMarks <= 0) return null;

  const normalize = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2);

  const agentTokens = new Set(normalize(agentAnswer));
  const expectedTokens = normalize(expectedAnswer);

  if (expectedTokens.length === 0) return null;

  let matchedCount = 0;
  for (const token of expectedTokens) {
    if (agentTokens.has(token)) {
      matchedCount++;
    } else {
      for (const aToken of agentTokens) {
        if (
          (aToken.length >= 4 && token.includes(aToken)) ||
          (token.length >= 4 && aToken.includes(token))
        ) {
          matchedCount += 0.75;
          break;
        }
      }
    }
  }

  const rawRatio = matchedCount / expectedTokens.length;
  const scorePct = Math.min(100, Math.round(rawRatio * 100));
  const suggestedMarks = Math.min(maxMarks, Math.round((scorePct / 100) * maxMarks));
  const confidence = scorePct >= 75 ? "high" : scorePct >= 40 ? "medium" : "low";

  return { scorePct, suggestedMarks, confidence };
}

function QuestionScoreRow({
  number,
  question,
  answer,
  attempt,
  allAttempts,
  reviewerId,
  disabled,
  onSaved,
  onBulkApplySameAnswer,
}: {
  number: number;
  question: Question;
  answer: AttemptAnswer;
  attempt: ExamAttempt;
  allAttempts?: ExamAttempt[];
  reviewerId: string;
  disabled: boolean;
  onSaved: (attempt: ExamAttempt) => void;
  onBulkApplySameAnswer?: (
    questionId: string,
    rawAgentAnswer: string,
    marks: number,
    comments: string,
    knowledgeGap?: KnowledgeGapCategory,
    sourceExamId?: string
  ) => Promise<void>;
}) {
  const [marks, setMarks] = useState<number | "">("");
  const [comments, setComments] = useState("");
  const [knowledgeGap, setKnowledgeGap] = useState<
    KnowledgeGapCategory | ""
  >("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setMarks(answer.marks ?? "");
    setComments(answer.comments ?? "");
    setKnowledgeGap(answer.knowledgeGapCategory ?? "");
  }, [
    answer.marks,
    answer.comments,
    answer.knowledgeGapCategory,
  ]);

  const isRescore = answer.marks !== undefined;
  const isAutoScored = answer.scoreHistory?.some(
    (h: ScoreHistoryEntry) => h.reason === "auto-scored"
  );

  const matchingOtherAttempts = useMemo(() => {
    if (!answer.agentAnswer || !allAttempts) return [];
    const norm = answer.agentAnswer.trim().toLowerCase();
    return allAttempts.filter((att) => {
      if (att.id === attempt.id) return false;
      if (att.examId !== attempt.examId) return false;
      if (att.status !== "submitted" && att.status !== "review_in_progress") return false;
      const otherAns = att.answers.find((a) => a.questionId === question.id);
      if (!otherAns) return false;
      return (otherAns.agentAnswer || "").trim().toLowerCase() === norm;
    });
  }, [allAttempts, attempt.id, attempt.examId, question.id, answer.agentAnswer]);

  const rubricSuggestion = useMemo(() => {
    if (
      question.type === "descriptive" ||
      question.type === "case_study" ||
      question.type === "image_based"
    ) {
      return computeRubricSuggestion(
        answer.agentAnswer,
        question.expectedAnswer,
        answer.maxMarks
      );
    }
    return null;
  }, [question.type, question.expectedAnswer, answer.agentAnswer, answer.maxMarks]);

  const numericMarks =
    marks === "" ? undefined : Number(marks);

  const needsKnowledgeGap =
    numericMarks !== undefined &&
    numericMarks < answer.maxMarks;

  const markState = useMemo(() => {
    if (numericMarks === undefined) return "Not Reviewed";

    if (numericMarks === answer.maxMarks) return "Correct";

    if (numericMarks === 0) return "Incorrect";

    return "Partial";
  }, [numericMarks, answer.maxMarks]);

  async function handleSaveDraft() {
    if (!reviewerId) return;

    setError("");
    setSaved(false);

    if (numericMarks === undefined) {
      setError("Enter marks before saving.");
      return;
    }

    if (
      numericMarks < 0 ||
      numericMarks > answer.maxMarks
    ) {
      setError(
        `Marks must be between 0 and ${answer.maxMarks}.`
      );
      return;
    }

    if (needsKnowledgeGap && !knowledgeGap) {
      setError(
        "Select a knowledge gap category for an answer that did not receive full marks."
      );
      return;
    }

    try {
      setSaving(true);

      const updatedAttempt = await saveReviewDraft(
        attempt,
        question.id,
        numericMarks,
        comments,
        reviewerId,
        knowledgeGap || undefined,
        isRescore ? reason : undefined
      );

      setSaved(true);
      setReason("");

      onSaved(updatedAttempt);
    } catch (err) {
      console.error(err);

      setError(
        err instanceof Error
          ? err.message
          : "Unable to save review."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Question {number}
          </p>

          <div className="mt-1 text-sm font-medium">
            <MarkdownRenderer content={question.questionText} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {isAutoScored && (
            <Badge color="purple">Auto-scored</Badge>
          )}

          <Badge
            color={
              markState === "Correct"
                ? "green"
                : markState === "Incorrect"
                ? "red"
                : markState === "Partial"
                ? "amber"
                : "slate"
            }
          >
            {markState}
          </Badge>
        </div>
      </div>

      {question.caseStudyContext && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/50">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Case Study Scenario / Context
          </p>
          <MarkdownRenderer content={question.caseStudyContext} />
        </div>
      )}

      <div className="mb-3 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Expected Answer / Rubric
        </p>

        <MarkdownRenderer content={question.expectedAnswer} />
      </div>

      <div className="mb-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Agent Answer
        </p>

        <AnswerDisplay
          question={question}
          agentAnswer={answer.agentAnswer}
        />
      </div>

      {rubricSuggestion && !disabled && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 p-2.5 text-xs dark:border-indigo-900/30 dark:bg-indigo-950/20">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-indigo-700 dark:text-indigo-300">
              Rubric-Assist Suggestion:
            </span>
            <span className="text-slate-600 dark:text-slate-300">
              {rubricSuggestion.suggestedMarks} / {answer.maxMarks} marks ({rubricSuggestion.scorePct}% match)
            </span>
          </div>
          <button
            type="button"
            className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-700 active:scale-95"
            onClick={() => {
              setMarks(rubricSuggestion.suggestedMarks);
              setSaved(false);
            }}
          >
            Accept Suggestion
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[120px_1fr_220px]">
        <div>
          <label className="mb-1 block text-xs font-medium">
            Marks / {answer.maxMarks}
          </label>

          <input
            id={`score-input-${attempt.id}-${number}`}
            type="number"
            min={0}
            max={answer.maxMarks}
            className="input"
            value={marks}
            disabled={disabled}
            onChange={(e) => {
              const value = e.target.value;

              setMarks(
                value === "" ? "" : Number(value)
              );
              setSaved(false);
            }}
            onKeyDown={async (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                await handleSaveDraft();
                const next = document.getElementById(
                  `score-input-${attempt.id}-${number + 1}`
                );
                if (next) {
                  (next as HTMLInputElement).focus();
                  (next as HTMLInputElement).select?.();
                }
              } else if (e.key === "ArrowDown" && (e.altKey || e.metaKey)) {
                e.preventDefault();
                const next = document.getElementById(
                  `score-input-${attempt.id}-${number + 1}`
                );
                if (next) {
                  (next as HTMLInputElement).focus();
                  (next as HTMLInputElement).select?.();
                }
              } else if (e.key === "ArrowUp" && (e.altKey || e.metaKey)) {
                e.preventDefault();
                const prev = document.getElementById(
                  `score-input-${attempt.id}-${number - 1}`
                );
                if (prev) {
                  (prev as HTMLInputElement).focus();
                  (prev as HTMLInputElement).select?.();
                }
              }
            }}
          />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-xs font-medium">
              Reviewer Comments
            </label>
            {!disabled && (
              <select
                className="cursor-pointer border-0 bg-transparent py-0 pl-1 pr-4 text-[11px] font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300"
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  if (val === "__add_custom__") {
                    const custom = window.prompt("Enter new reusable comment template:");
                    if (custom && custom.trim()) {
                      saveCustomTemplate(custom.trim());
                      setComments((prev) => (prev ? `${prev} ${custom.trim()}` : custom.trim()));
                      setSaved(false);
                    }
                  } else {
                    setComments((prev) => (prev ? `${prev} ${val}` : val));
                    setSaved(false);
                  }
                  e.target.value = "";
                }}
                defaultValue=""
              >
                <option value="" disabled>
                  + Insert template...
                </option>
                {getStoredTemplates().map((t, idx) => (
                  <option key={idx} value={t}>
                    {t.length > 50 ? `${t.slice(0, 50)}...` : t}
                  </option>
                ))}
                <option value="__add_custom__">+ Create new template...</option>
              </select>
            )}
          </div>

          <input
            className="input"
            value={comments}
            disabled={disabled}
            placeholder="Add feedback or choose a quick template..."
            onChange={(e) => {
              setComments(e.target.value);
              setSaved(false);
            }}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                await handleSaveDraft();
                const next = document.getElementById(
                  `score-input-${attempt.id}-${number + 1}`
                );
                if (next) {
                  (next as HTMLInputElement).focus();
                }
              }
            }}
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium">
            Knowledge Gap
          </label>

          <select
            className="input"
            value={knowledgeGap}
            disabled={disabled || !needsKnowledgeGap}
            onChange={(e) => {
              setKnowledgeGap(
                e.target.value as KnowledgeGapCategory | ""
              );
              setSaved(false);
            }}
          >
            <option value="">
              {needsKnowledgeGap
                ? "Select category..."
                : "Not required"}
            </option>

            {KNOWLEDGE_GAPS.map((gap) => (
              <option key={gap} value={gap}>
                {gap}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isRescore && !disabled && (
        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium">
            Reason for Score Change
          </label>

          <input
            className="input"
            placeholder="Optional reason for changing the previous score"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      )}

      {error && (
        <p className="mt-2 text-xs font-medium text-red-600">
          {error}
        </p>
      )}

      {!disabled && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleSaveDraft}
            disabled={saving}
          >
            <Save className="h-4 w-4" />

            {saving
              ? "Saving..."
              : isRescore
              ? "Update Draft"
              : "Save Draft"}
          </button>

          {saved && (
            <span className="flex items-center gap-1 text-xs font-medium text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Saved
            </span>
          )}

          {matchingOtherAttempts.length > 0 && (
            <button
              type="button"
              className="btn-secondary text-xs flex items-center gap-1.5 border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
              onClick={() => {
                if (numericMarks === undefined) {
                  setError("Enter marks first before applying to matching candidates.");
                  return;
                }
                onBulkApplySameAnswer?.(
                  question.id,
                  answer.agentAnswer,
                  numericMarks,
                  comments,
                  knowledgeGap || undefined,
                  attempt.examId
                );
              }}
              title={`Apply this score (${numericMarks ?? "?"} marks) and comment to ${matchingOtherAttempts.length} other pending attempt(s) with identical answer`}
            >
              <Users className="h-3.5 w-3.5" />
              Apply to {matchingOtherAttempts.length} matching candidate{matchingOtherAttempts.length === 1 ? "" : "s"}
            </button>
          )}

          {answer.scoreHistory &&
            answer.scoreHistory.length > 0 && (
              <button
                className="flex items-center gap-1 text-xs text-slate-500 hover:underline"
                onClick={() =>
                  setShowHistory((s) => !s)
                }
              >
                <History className="h-3.5 w-3.5" />

                {answer.scoreHistory.length} score
                change(s)
              </button>
            )}
        </div>
      )}

      {showHistory && answer.scoreHistory && (
        <div className="mt-3 space-y-1 rounded-lg bg-amber-50 p-3 text-xs dark:bg-amber-900/20">
          {answer.scoreHistory.map((h: ScoreHistoryEntry, i: number) => (
            <p key={i}>
              Score changed to{" "}
              <strong>{h.marks}</strong> by{" "}
              {h.changedBy} - &quot;{h.reason}&quot; (
              {new Date(h.timestamp).toLocaleString()})
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function formatStatus(status: ExamAttempt["status"]) {
  switch (status) {
    case "in_progress":
      return "In Progress";

    case "submitted":
      return "Needs Review";

    case "review_in_progress":
      return "Review In Progress";

    case "reviewed":
      return "Reviewed";

    default:
      return status;
  }
}