"use client";

import { useEffect, useState, useMemo } from "react";
import { fetchUsersByRole } from "@/lib/users";
import { updateExam } from "@/lib/exams";
import { fetchAttemptsForExam } from "@/lib/attempts";
import { getQuestionsByIds, createRedactedQuestionSnapshot } from "@/lib/questions";
import type { Exam, AppUser, ExamStatus, ExamAttempt, Question } from "@/types";
import {
  Search,
  Users,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  ArrowLeft,
  ArrowRight,
  HelpCircle,
  Sparkles,
  Info,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface AssignAgentsModalProps {
  exam: Exam;
  onDone: (patch: { assignedAgentIds: string[]; status: ExamStatus }) => void;
  onClose?: () => void;
}

export type AgentStatusType =
  | "never_assigned"
  | "assigned_no_attempt"
  | "in_progress"
  | "awaiting_review"
  | "reviewed"
  | "has_reattempts";

export interface AgentExamIntelligence {
  agent: AppUser;
  isAssigned: boolean;
  attempts: ExamAttempt[];
  statusType: AgentStatusType;
  latestAttempt?: ExamAttempt;
  latestReviewedAttempt?: ExamAttempt;
  missedQuestions: {
    questionId: string;
    questionText: string;
    agentAnswer?: string;
    marks?: number;
    maxMarks: number;
    comments?: string;
  }[];
}

type ReassignMode = "same_questions" | "wrong_answers" | "select_questions";

export function AssignAgentsModal({ exam, onDone, onClose }: AssignAgentsModalProps) {
  const [agents, setAgents] = useState<AppUser[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [questionsMap, setQuestionsMap] = useState<Record<string, Question>>(
    exam.questionSnapshots ?? {}
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTab, setFilterTab] = useState<"all" | "unassigned" | "assigned" | "reviewed">("all");

  // Multi-select for standard assignment
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());

  // Dedicated Reassignment Studio State
  const [activeReassignAgent, setActiveReassignAgent] = useState<AgentExamIntelligence | null>(null);
  const [reassignStep, setReassignStep] = useState<"options" | "confirm">("options");
  const [reassignMode, setReassignMode] = useState<ReassignMode>("same_questions");
  const [customSelectedQuestionIds, setCustomSelectedQuestionIds] = useState<Set<string>>(new Set());
  const [reassignSuccessMsg, setReassignSuccessMsg] = useState("");

  // Load Agents, Attempts, and Question Content concurrently
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    const examQIds = (exam.questions || []).map((q) => q.questionId);
    const questionIdsToFetch = examQIds.filter(
      (id) => !exam.questionSnapshots?.[id]?.questionText
    );

    Promise.all([
      fetchUsersByRole("agent"),
      fetchAttemptsForExam(exam.id),
      questionIdsToFetch.length > 0 ? getQuestionsByIds(questionIdsToFetch) : Promise.resolve([]),
    ])
      .then(async ([loadedAgents, loadedAttempts, fetchedQuestions]) => {
        if (!active) return;
        setAgents(loadedAgents);
        setAttempts(loadedAttempts);
        // Pre-select currently assigned agents that haven't taken the exam
        const assignedSet = new Set(exam.assignedAgentIds || []);
        setSelectedAgentIds(assignedSet);

        const newMap: Record<string, Question> = { ...(exam.questionSnapshots || {}) };
        fetchedQuestions.forEach((q) => {
          if (q) newMap[q.id] = q;
        });

        // Check if any attempt answers are missing questionText
        const attemptQIds = loadedAttempts.flatMap((a) => (a.answers || []).map((ans) => ans.questionId));
        const missingAttemptQIds = Array.from(new Set(attemptQIds)).filter(
          (id) => !newMap[id]?.questionText
        );

        if (missingAttemptQIds.length > 0) {
          const additional = await getQuestionsByIds(missingAttemptQIds);
          if (active) {
            additional.forEach((q) => {
              if (q) newMap[q.id] = q;
            });
          }
        }

        if (active) {
          setQuestionsMap(newMap);
        }
      })
      .catch((err) => {
        if (!active) return;
        console.error("Failed to load assignment data:", err);
        setError(err instanceof Error ? err.message : "Failed to load agent assignment data.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [exam.id, exam.assignedAgentIds, exam.questions, exam.questionSnapshots]);

  // Compute intelligence map for each agent
  const agentIntelligenceList: AgentExamIntelligence[] = useMemo(() => {
    const attemptsByAgent = new Map<string, ExamAttempt[]>();
    for (const att of attempts) {
      const list = attemptsByAgent.get(att.agentId) || [];
      list.push(att);
      attemptsByAgent.set(att.agentId, list);
    }

    const assignedSet = new Set(exam.assignedAgentIds || []);

    return agents.map((agent) => {
      const agentAttempts = (attemptsByAgent.get(agent.uid) || []).sort(
        (a, b) => (b.attemptNumber || 0) - (a.attemptNumber || 0) || (b.startedAt || 0) - (a.startedAt || 0)
      );

      const isAssigned = assignedSet.has(agent.uid);
      const latestAttempt = agentAttempts[0];
      const latestReviewed = agentAttempts.find((a) => a.status === "reviewed");

      // Extract missed questions from latest reviewed attempt
      const missed: AgentExamIntelligence["missedQuestions"] = [];
      if (latestReviewed && Array.isArray(latestReviewed.answers)) {
        for (const ans of latestReviewed.answers) {
          if (ans.marks === undefined || ans.marks < ans.maxMarks) {
            const qText =
              questionsMap[ans.questionId]?.questionText ||
              exam.questionSnapshots?.[ans.questionId]?.questionText ||
              ans.questionSnapshot?.questionText ||
              `Question #${missed.length + 1}`;
            missed.push({
              questionId: ans.questionId,
              questionText: qText,
              agentAnswer: ans.agentAnswer,
              marks: ans.marks,
              maxMarks: ans.maxMarks,
              comments: ans.comments,
            });
          }
        }
      }

      // Determine precise status type
      let statusType: AgentStatusType = "never_assigned";
      if (agentAttempts.length === 0) {
        statusType = isAssigned ? "assigned_no_attempt" : "never_assigned";
      } else if (agentAttempts.some((a) => a.status === "in_progress")) {
        statusType = "in_progress";
      } else if (agentAttempts.some((a) => a.status === "submitted" || a.status === "review_in_progress")) {
        statusType = "awaiting_review";
      } else if (agentAttempts.length > 1) {
        statusType = "has_reattempts";
      } else if (latestReviewed) {
        statusType = "reviewed";
      }

      return {
        agent,
        isAssigned,
        attempts: agentAttempts,
        statusType,
        latestAttempt,
        latestReviewedAttempt: latestReviewed,
        missedQuestions: missed,
      };
    });
  }, [agents, attempts, exam.assignedAgentIds, exam.questionSnapshots, questionsMap]);

  // Filtered list based on search & tab
  const filteredAgents = useMemo(() => {
    return agentIntelligenceList.filter((item) => {
      const matchesSearch =
        item.agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.agent.email.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (filterTab === "unassigned") return !item.isAssigned && item.attempts.length === 0;
      if (filterTab === "assigned") return item.isAssigned;
      if (filterTab === "reviewed") return item.attempts.some((a) => a.status === "reviewed");
      return true;
    });
  }, [agentIntelligenceList, searchQuery, filterTab]);

  // Multi-select toggle
  function toggleAgentSelection(uid: string) {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  }

  // Save standard assignments (New / Multi-agent)
  async function handleSaveStandardAssignments() {
    setSaving(true);
    setError("");

    // Preserve existing assignments and ensure agents with attempt history can never be dropped
    const historyAgentIds = agentIntelligenceList
      .filter((a) => a.attempts.length > 0)
      .map((a) => a.agent.uid);
    const merged = new Set([...selectedAgentIds, ...historyAgentIds]);
    const updatedAssignedIds = Array.from(merged);
    const targetStatus: ExamStatus = exam.status === "draft" ? "published" : exam.status;

    // Ensure safe questionSnapshots are populated if the exam was missing them
    const currentSnapshots = { ...(exam.questionSnapshots || {}) };
    let needsSnapshotUpdate = false;
    for (const qRef of exam.questions || []) {
      if (!currentSnapshots[qRef.questionId] && questionsMap[qRef.questionId]) {
        currentSnapshots[qRef.questionId] = createRedactedQuestionSnapshot(questionsMap[qRef.questionId]);
        needsSnapshotUpdate = true;
      }
    }

    try {
      const updatePayload: Partial<Exam> = {
        assignedAgentIds: updatedAssignedIds,
        status: targetStatus,
        ...(needsSnapshotUpdate ? { questionSnapshots: currentSnapshots } : {}),
      };
      await updateExam(exam.id, updatePayload);
      onDone({
        assignedAgentIds: updatedAssignedIds,
        status: targetStatus,
        ...(needsSnapshotUpdate ? { questionSnapshots: currentSnapshots } : {}),
      });
    } catch (err) {
      console.error("Failed to update assignments:", err);
      setError(err instanceof Error ? err.message : "Failed to save assignments. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  // Open Reassignment Studio for a specific agent
  function startReassignment(agentIntel: AgentExamIntelligence) {
    setActiveReassignAgent(agentIntel);
    setReassignStep("options");
    setReassignMode("same_questions");
    // Pre-populate custom selected questions with all exam questions
    setCustomSelectedQuestionIds(new Set(exam.questions.map((q) => q.questionId)));
    setReassignSuccessMsg("");
  }

  // Confirm Reassignment
  async function handleConfirmReassignment() {
    if (!activeReassignAgent) return;
    setSaving(true);
    setError("");

    try {
      // Ensure agent is in assignedAgentIds
      const updatedSet = new Set(exam.assignedAgentIds || []);
      updatedSet.add(activeReassignAgent.agent.uid);
      const updatedAssignedIds = Array.from(updatedSet);
      const targetStatus: ExamStatus = exam.status === "draft" ? "published" : exam.status;

      // Determine questionIds based on reassignMode
      let questionIds: string[] | undefined;
      if (reassignMode === "same_questions") {
        questionIds = exam.questions.map((q) => q.questionId);
      } else if (reassignMode === "wrong_answers") {
        questionIds = activeReassignAgent.missedQuestions.map((q) => q.questionId);
      } else {
        questionIds = Array.from(customSelectedQuestionIds);
      }

      const reattemptPermissions = {
        ...(exam.reattemptPermissions || {}),
        [activeReassignAgent.agent.uid]: {
          agentId: activeReassignAgent.agent.uid,
          mode: reassignMode,
          questionIds,
          grantedAt: Date.now(),
          grantedBy: exam.createdBy || "auditor",
        },
      };

      await updateExam(exam.id, {
        assignedAgentIds: updatedAssignedIds,
        status: targetStatus,
        reattemptPermissions,
      });

      setReassignSuccessMsg(
        `Reassignment confirmed for ${activeReassignAgent.agent.name}. Next attempt will be serviced as a reattempt.`
      );

      setTimeout(() => {
        onDone({
          assignedAgentIds: updatedAssignedIds,
          status: targetStatus,
        });
      }, 1800);
    } catch (err) {
      console.error("Failed to confirm reassignment:", err);
      setError(err instanceof Error ? err.message : "Failed to confirm reassignment. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  // Compute question count for reassignment confirmation
  const reassignedQuestionCount = useMemo(() => {
    if (reassignMode === "same_questions") return exam.questions.length;
    if (reassignMode === "wrong_answers") return activeReassignAgent?.missedQuestions.length || 0;
    return customSelectedQuestionIds.size;
  }, [reassignMode, exam.questions.length, activeReassignAgent, customSelectedQuestionIds]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-500">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
        <p className="text-sm">Analyzing agent attempt histories...</p>
      </div>
    );
  }

  // =========================================================================
  // VIEW 2: REASSIGNMENT STUDIO
  // =========================================================================
  if (activeReassignAgent) {
    const latestRev = activeReassignAgent.latestReviewedAttempt;

    return (
      <div className="space-y-4">
        {/* Studio Breadcrumb / Back Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            onClick={() => setActiveReassignAgent(null)}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Agent List
          </button>
          <span className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-950/30 dark:text-brand-300">
            Reassignment Studio
          </span>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {reassignSuccessMsg && (
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>{reassignSuccessMsg}</span>
          </div>
        )}

        {/* Agent & History Summary Banner */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Target Agent</p>
              <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {activeReassignAgent.agent.name}
              </h4>
              <p className="text-xs text-slate-500">{activeReassignAgent.agent.email}</p>
            </div>
            {latestRev && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-right dark:border-emerald-800/50 dark:bg-emerald-950/20">
                <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Previous Result</p>
                <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
                  {latestRev.totalMarks ?? 0} / {latestRev.maxTotalMarks ?? 0} marks
                  {latestRev.maxTotalMarks
                    ? ` (${Math.round(((latestRev.totalMarks ?? 0) / latestRev.maxTotalMarks) * 100)}%)`
                    : ""}
                </p>
                <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
                  Attempt {latestRev.attemptNumber || 1} · {activeReassignAgent.attempts.length}{" "}
                  {activeReassignAgent.attempts.length === 1 ? "attempt" : "attempts"} total
                </p>
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <Info className="h-3.5 w-3.5 text-brand-600" />
            <span>
              This agent has completed this test. This reassignment will be tracked as a reattempt, preserving their
              historical attempt records.
            </span>
          </div>
        </div>

        {/* STEP 1: OPTIONS SELECTION */}
        {reassignStep === "options" && (
          <div className="space-y-4">
            <h5 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Select Question Set for Reattempt
            </h5>

            <div className="grid grid-cols-1 gap-3">
              {/* Option A: Same Questions (Default) */}
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all ${
                  reassignMode === "same_questions"
                    ? "border-brand-600 bg-brand-50/40 ring-1 ring-brand-600 dark:bg-brand-950/20"
                    : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
                }`}
              >
                <input
                  type="radio"
                  name="reassign_mode"
                  className="mt-1"
                  checked={reassignMode === "same_questions"}
                  onChange={() => setReassignMode("same_questions")}
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Use questions from this exam (Default)
                    </p>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      {exam.questions.length} questions
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Reassign the complete existing exam question set. The agent retakes the entire test.
                  </p>
                </div>
              </label>

              {/* Option B: Wrongly Answered Questions */}
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all ${
                  activeReassignAgent.missedQuestions.length === 0 ? "opacity-60 cursor-not-allowed" : ""
                } ${
                  reassignMode === "wrong_answers"
                    ? "border-brand-600 bg-brand-50/40 ring-1 ring-brand-600 dark:bg-brand-950/20"
                    : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
                }`}
              >
                <input
                  type="radio"
                  name="reassign_mode"
                  className="mt-1"
                  disabled={activeReassignAgent.missedQuestions.length === 0}
                  checked={reassignMode === "wrong_answers"}
                  onChange={() => setReassignMode("wrong_answers")}
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                      Wrongly answered questions only
                    </p>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-semibold ${
                        activeReassignAgent.missedQuestions.length > 0
                          ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          : "bg-slate-100 text-slate-400 dark:bg-slate-700"
                      }`}
                    >
                      {activeReassignAgent.missedQuestions.length} eligible
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Automatically targets only the specific questions {activeReassignAgent.agent.name} answered
                    incorrectly or received partial marks on in their previous reviewed attempt.
                  </p>
                  {activeReassignAgent.missedQuestions.length === 0 && (
                    <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                      ✓ Agent scored 100% on all questions in their last reviewed attempt. No incorrect questions found.
                    </p>
                  )}
                </div>
              </label>

              {/* Option C: Select specific questions */}
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-all ${
                  reassignMode === "select_questions"
                    ? "border-brand-600 bg-brand-50/40 ring-1 ring-brand-600 dark:bg-brand-950/20"
                    : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
                }`}
              >
                <input
                  type="radio"
                  name="reassign_mode"
                  className="mt-1"
                  checked={reassignMode === "select_questions"}
                  onChange={() => setReassignMode("select_questions")}
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Select questions manually
                    </p>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                      {customSelectedQuestionIds.size} of {exam.questions.length} selected
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Hand-pick specific questions from this exam with previous score and feedback context.
                  </p>
                </div>
              </label>
            </div>

            {/* Sub-view: Wrong answers list preview */}
            {reassignMode === "wrong_answers" && activeReassignAgent.missedQuestions.length > 0 && (
              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/30 p-3 dark:border-amber-900/40 dark:bg-amber-950/10">
                <p className="text-xs font-bold text-amber-900 dark:text-amber-300">
                  Preview of {activeReassignAgent.missedQuestions.length} missed question(s):
                </p>
                <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                  {activeReassignAgent.missedQuestions.map((q, idx) => (
                    <div
                      key={q.questionId}
                      className="rounded-lg border border-amber-200/70 bg-white p-2.5 text-xs shadow-sm dark:border-slate-700 dark:bg-slate-800"
                    >
                      <div className="flex items-center justify-between text-slate-400">
                        <span className="font-mono font-bold text-slate-600 dark:text-slate-300">#{idx + 1}</span>
                        <span className="font-medium text-red-600 dark:text-red-400">
                          Previous Score: {q.marks ?? 0} / {q.maxMarks} marks
                        </span>
                      </div>
                      <p className="mt-1 font-medium text-slate-800 line-clamp-2 dark:text-slate-200">
                        {q.questionText}
                      </p>
                      {q.comments && (
                        <p className="mt-1 rounded bg-slate-50 p-1 text-[11px] text-slate-600 dark:bg-slate-700/50 dark:text-slate-300">
                          <strong>Auditor Note:</strong> {q.comments}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sub-view: Manual Selection Question List */}
            {reassignMode === "select_questions" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Questions in this test:</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-brand-600 hover:underline"
                      onClick={() => setCustomSelectedQuestionIds(new Set(exam.questions.map((q) => q.questionId)))}
                    >
                      Select all
                    </button>
                    <span>·</span>
                    <button
                      type="button"
                      className="text-brand-600 hover:underline"
                      onClick={() => setCustomSelectedQuestionIds(new Set())}
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 p-2 dark:border-slate-700">
                  {exam.questions.map((qRef, idx) => {
                    const qId = qRef.questionId;
                    const q = questionsMap[qId] || exam.questionSnapshots?.[qId];
                    const isChecked = customSelectedQuestionIds.has(qId);
                    const prevAns = latestRev?.answers.find((a) => a.questionId === qId);

                    return (
                      <label
                        key={qId}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-lg p-2 transition-colors ${
                          isChecked ? "bg-brand-50/50 dark:bg-brand-950/20" : "hover:bg-slate-50 dark:hover:bg-slate-800"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={isChecked}
                          onChange={() => {
                            setCustomSelectedQuestionIds((prev) => {
                              const next = new Set(prev);
                              next.has(qId) ? next.delete(qId) : next.add(qId);
                              return next;
                            });
                          }}
                        />
                        <div className="flex-1 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-slate-500">#{idx + 1}</span>
                            {prevAns && (
                              <span
                                className={`font-semibold ${
                                  (prevAns.marks ?? 0) >= prevAns.maxMarks
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-amber-600 dark:text-amber-400"
                                }`}
                              >
                                Prev: {prevAns.marks ?? 0}/{prevAns.maxMarks}
                              </span>
                            )}
                          </div>
                          <p className="font-medium text-slate-800 line-clamp-3 dark:text-slate-200" title={q?.questionText}>
                            {q?.questionText || `Question #${idx + 1}`}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Next Button */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setActiveReassignAgent(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={reassignedQuestionCount === 0}
                onClick={() => setReassignStep("confirm")}
              >
                Continue to Review <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 2: REASSIGNMENT CONFIRMATION SUMMARY */}
        {reassignStep === "confirm" && (
          <div className="space-y-4">
            <h5 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Confirm Reassignment Details
            </h5>

            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white p-4 shadow-sm text-sm dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-800">
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">Agent</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {activeReassignAgent.agent.name} ({activeReassignAgent.agent.email})
                </span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">Original Test</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">{exam.name}</span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">Original Attempt</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  Attempt {latestRev?.attemptNumber || 1}{" "}
                  {latestRev ? `(Score: ${latestRev.totalMarks}/${latestRev.maxTotalMarks})` : ""}
                </span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">New Attempt</span>
                <span className="font-bold text-brand-600 dark:text-brand-400">
                  Reattempt (Attempt {(activeReassignAgent.attempts.length || 1) + 1})
                </span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">Question Selection</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  {reassignMode === "same_questions" && "Same questions from original exam"}
                  {reassignMode === "wrong_answers" && "Wrongly answered questions only"}
                  {reassignMode === "select_questions" && "Custom question selection"}
                </span>
              </div>
              <div className="py-2 flex justify-between">
                <span className="text-slate-500">Question Count</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {reassignedQuestionCount} {reassignedQuestionCount === 1 ? "question" : "questions"}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setReassignStep("options")}
                disabled={saving}
              >
                Back / Edit
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleConfirmReassignment}
                disabled={saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Confirming...
                  </>
                ) : (
                  "Confirm Reassignment"
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // VIEW 1: MAIN ASSIGNMENT HUB
  // =========================================================================
  const currentlyAssignedCount = agentIntelligenceList.filter((a) => a.isAssigned).length;
  const hasHistoryCount = agentIntelligenceList.filter((a) => a.attempts.length > 0).length;

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Summary Metrics */}
      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 text-center dark:border-slate-700 dark:bg-slate-800/40">
          <p className="text-lg font-bold text-slate-900 dark:text-slate-100">{agents.length}</p>
          <p className="text-[11px] text-slate-500">Total Agents</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 text-center dark:border-slate-700 dark:bg-slate-800/40">
          <p className="text-lg font-bold text-brand-600 dark:text-brand-400">{currentlyAssignedCount}</p>
          <p className="text-[11px] text-slate-500">Currently Assigned</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-2.5 text-center dark:border-slate-700 dark:bg-slate-800/40">
          <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{hasHistoryCount}</p>
          <p className="text-[11px] text-slate-500">Completed / History</p>
        </div>
      </div>

      {/* Search & Filter Tabs */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            className="input pl-9 text-xs"
            placeholder="Search agents by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="flex gap-1 border-b border-slate-200 text-xs dark:border-slate-700">
          <button
            type="button"
            className={`px-3 py-1.5 font-medium transition-colors border-b-2 ${
              filterTab === "all"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
            onClick={() => setFilterTab("all")}
          >
            All Agents ({agentIntelligenceList.length})
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 font-medium transition-colors border-b-2 ${
              filterTab === "unassigned"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
            onClick={() => setFilterTab("unassigned")}
          >
            Unassigned ({agentIntelligenceList.filter((a) => !a.isAssigned && a.attempts.length === 0).length})
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 font-medium transition-colors border-b-2 ${
              filterTab === "assigned"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
            onClick={() => setFilterTab("assigned")}
          >
            Assigned ({currentlyAssignedCount})
          </button>
          <button
            type="button"
            className={`px-3 py-1.5 font-medium transition-colors border-b-2 ${
              filterTab === "reviewed"
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
            onClick={() => setFilterTab("reviewed")}
          >
            Has Reviewed ({agentIntelligenceList.filter((a) => a.attempts.some((att) => att.status === "reviewed")).length})
          </button>
        </div>
      </div>

      {/* Agents List with Intelligent Badging */}
      {filteredAgents.length === 0 ? (
        <p className="py-8 text-center text-xs text-slate-400">No agents match the current filter.</p>
      ) : (
        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {filteredAgents.map((item) => {
            const isChecked = selectedAgentIds.has(item.agent.uid);
            const hasReviewed = item.attempts.some((a) => a.status === "reviewed");
            const latestRev = item.latestReviewedAttempt;

            return (
              <div
                key={item.agent.uid}
                className={`flex items-center justify-between gap-3 rounded-xl border p-2.5 transition-colors ${
                  isChecked
                    ? "border-brand-300 bg-brand-50/30 dark:border-brand-800/60 dark:bg-brand-950/20"
                    : "border-slate-200 hover:bg-slate-50/70 dark:border-slate-700 dark:hover:bg-slate-800/40"
                }`}
              >
                {/* Checkbox & Agent Details */}
                <label className="flex flex-1 cursor-pointer items-center gap-2.5 min-w-0">
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleAgentSelection(item.agent.uid)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-200">
                        {item.agent.name}
                      </p>
                      {/* State Badge */}
                      {item.statusType === "never_assigned" && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          New Agent
                        </span>
                      )}
                      {item.statusType === "assigned_no_attempt" && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          Assigned · Pending
                        </span>
                      )}
                      {item.statusType === "in_progress" && (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                          In Progress
                        </span>
                      )}
                      {item.statusType === "awaiting_review" && (
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-800 dark:bg-purple-950 dark:text-purple-300">
                          Awaiting Review
                        </span>
                      )}
                      {(item.statusType === "reviewed" || item.statusType === "has_reattempts") && latestRev && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          Score: {latestRev.totalMarks}/{latestRev.maxTotalMarks} ({item.attempts.length}{" "}
                          {item.attempts.length === 1 ? "attempt" : "attempts"})
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[11px] text-slate-400">{item.agent.email}</p>
                  </div>
                </label>

                {/* Explicit Reassign Action for Agents with Completed History */}
                {hasReviewed && (
                  <button
                    type="button"
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-brand-200 bg-white px-2.5 py-1 text-xs font-semibold text-brand-700 shadow-sm hover:bg-brand-50 dark:border-brand-800 dark:bg-slate-800 dark:text-brand-300 dark:hover:bg-brand-950/40"
                    onClick={() => startReassignment(item)}
                    title="Configure reattempt for this agent"
                  >
                    <RotateCcw className="h-3 w-3" /> Reassign
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation & Multi-Agent Footer */}
      <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            <strong>{selectedAgentIds.size}</strong> agent(s) selected for assignment.
          </p>
          <div className="flex gap-2">
            {onClose && (
              <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
                Cancel
              </button>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={handleSaveStandardAssignments}
              disabled={saving}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving...
                </>
              ) : (
                `Confirm Assignments (${selectedAgentIds.size})`
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

