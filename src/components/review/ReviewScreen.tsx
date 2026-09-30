"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { fetchExams } from "@/lib/exams";
import {
  fetchAttemptsForExam,
  finalizeAttemptReview,
  saveAllReviewDraftScores,
  computeMergedScorecard,
  computeExamMasterScorecard,
} from "@/lib/attempts";
import { getQuestionsByIds } from "@/lib/questions";
import { fetchAllUsers } from "@/lib/users";
import { saveAiReviewToAttempt } from "@/lib/aiReview";
import { useAuth } from "@/context/AuthContext";
import { auth, db } from "@/lib/firebase";
import { doc, onSnapshot } from "firebase/firestore";
import type {
  Exam,
  ExamAttempt,
  Question,
  AppUser,
  KnowledgeGapCategory,
  ExamAssignment,
} from "@/types";
import { AnswerDisplay } from "@/components/questions/AnswerDisplay";
import { QuestionContent } from "@/components/questions/QuestionContent";
import { Badge, EmptyState, Modal } from "@/components/ui/Primitives";
import {
  ChevronDown,
  ChevronRight,
  History,
  Save,
  CheckCircle2,
  AlertTriangle,
  Pencil,
  Layers,
  RotateCcw,
  Sparkles,
  Bot,
  AlertCircle,
  Loader2,
  Check,
} from "lucide-react";
import { AmendScorecardModal } from "./AmendScorecardModal";
import { ReassignModal } from "./ReassignModal";

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

export function ReviewScreen() {
  const { profile } = useAuth();
  const params = useParams();
  const routeExamId = typeof params?.examId === "string" ? params.examId : "";

  const [exams, setExams] = useState<Exam[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [selectedExam, setSelectedExam] = useState(routeExamId);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [questionCache, setQuestionCache] = useState<Record<string, Question>>({});
  const [expanded, setExpanded] = useState<string | null>(null);

  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Reassignment & Amend Modals
  const [reassigningAttempt, setReassigningAttempt] = useState<ExamAttempt | null>(null);
  const [amendingAttempt, setAmendingAttempt] = useState<ExamAttempt | null>(null);
  const [viewingMergedAgentId, setViewingMergedAgentId] = useState<string | null>(null);

  const selectedExamDoc = useMemo(
    () => exams.find((e) => e.id === selectedExam),
    [exams, selectedExam]
  );

  const masterScorecardData = useMemo(() => {
    if (!viewingMergedAgentId || !selectedExamDoc) return null;
    const agentAttempts = attempts.filter((a) => a.agentId === viewingMergedAgentId);
    return computeExamMasterScorecard(selectedExamDoc, agentAttempts);
  }, [viewingMergedAgentId, selectedExamDoc, attempts]);

  useEffect(() => {
    Promise.all([fetchExams(), fetchAllUsers()])
      .then(([loadedExams, loadedUsers]) => {
        setExams(loadedExams);
        setUsers(loadedUsers);
      })
      .catch((err) => {
        console.error("Failed to load review data", err);
        setMessage({
          type: "error",
          text: err instanceof Error ? err.message : "Unable to load review data.",
        });
      });
  }, []);

  useEffect(() => {
    if (!selectedExam) {
      setAttempts([]);
      return;
    }

    loadAttempts(selectedExam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedExam]);

  async function loadAttempts(examId: string) {
    const list = await fetchAttemptsForExam(examId);
    setAttempts(list);

    const ids = new Set(
      list.flatMap((a) => a.answers.map((ans) => ans.questionId))
    );

    const missing = Array.from(ids).filter((id) => !questionCache[id]);

    if (missing.length) {
      const fetched = await getQuestionsByIds(missing);
      setQuestionCache((prev) => {
        const next = { ...prev };
        fetched.forEach((q) => {
          if (q) next[q.id] = q;
        });
        return next;
      });
    }
  }

  function patchAttempt(updated: ExamAttempt) {
    setAttempts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  function userName(uid: string) {
    return users.find((u) => u.uid === uid)?.name ?? uid.slice(0, 8);
  }

  const pendingCount = attempts.filter(
    (a) => a.status === "submitted" || a.status === "review_in_progress"
  ).length;

  const selectedExamObject = exams.find((e) => e.id === selectedExam);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Review Attempts</h1>

        <select
          className="input w-auto"
          value={selectedExam}
          onChange={(e) => {
            setSelectedExam(e.target.value);
            setExpanded(null);
            setMessage(null);
          }}
        >
          <option value="">Select an exam...</option>
          {exams.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>

        {selectedExam && pendingCount > 0 && (
          <Badge color="amber">{pendingCount} pending review</Badge>
        )}
      </div>

      {selectedExamObject && (
        <div className="mb-4 text-sm text-slate-500">
          Exam mode:{" "}
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {selectedExamObject.mode === "until_perfect" ? "Perfect 10" : "Normal"}
          </span>
        </div>
      )}

      {message && (
        <div
          className={`mb-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {!selectedExam ? (
        <EmptyState
          title="No exam selected"
          subtitle="Select an exam from the dropdown above to view submitted attempts."
        />
      ) : attempts.length === 0 ? (
        <EmptyState
          title="No attempts found"
          subtitle="There are no attempts submitted for this exam yet."
        />
      ) : (
        <div className="space-y-4">
          {attempts.map((attempt) => {
            const isReviewed = attempt.status === "reviewed";

            return (
              <div
                key={attempt.id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                {/* Attempt Header Bar */}
                <button
                  type="button"
                  className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/50"
                  onClick={() =>
                    setExpanded(expanded === attempt.id ? null : attempt.id)
                  }
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {expanded === attempt.id ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-slate-900 dark:text-slate-100">
                          {userName(attempt.agentId)} · Attempt #{attempt.attemptNumber}
                        </p>
                        {attempt.isReattempt && (
                          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                            Reattempt{attempt.reattemptSource ? ` · ${attempt.reattemptSource.replace("_", " ")}` : ""}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-500">
                        {attempt.timeTakenSeconds
                          ? `${Math.round(attempt.timeTakenSeconds / 60)} min · `
                          : ""}
                        {new Date(attempt.startedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {/* Master Scorecard Trigger */}
                    {attempts.filter((a) => a.agentId === attempt.agentId && a.status === "reviewed").length > 1 && (
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded-lg border border-brand-200 bg-white px-2 py-1 text-[11px] font-semibold text-brand-700 shadow-sm hover:bg-brand-50 dark:border-brand-800 dark:bg-slate-800 dark:text-brand-300 dark:hover:bg-brand-950/40"
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewingMergedAgentId(attempt.agentId);
                        }}
                        title="View Master Scorecard"
                      >
                        <Layers className="h-3 w-3" />
                        Master Scorecard
                      </button>
                    )}

                    {/* Quick Reassign button directly in header if reviewed */}
                    {isReviewed && (
                      <button
                        type="button"
                        className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/50"
                        onClick={(e) => {
                          e.stopPropagation();
                          setReassigningAttempt(attempt);
                        }}
                        title="Reassign this exam"
                      >
                        <RotateCcw className="h-3 w-3 text-brand-600" />
                        Reassign
                      </button>
                    )}

                    {/* Status Badge */}
                    {isReviewed && attempt.maxTotalMarks ? (
                      <Badge
                        color={
                          attempt.totalMarks === attempt.maxTotalMarks
                            ? "green"
                            : "brand"
                        }
                      >
                        {attempt.totalMarks} / {attempt.maxTotalMarks}
                      </Badge>
                    ) : (
                      <Badge
                        color={
                          attempt.status === "submitted"
                            ? "amber"
                            : attempt.status === "review_in_progress"
                            ? "brand"
                            : "slate"
                        }
                      >
                        {formatStatus(attempt.status)}
                      </Badge>
                    )}
                  </div>
                </button>

                {/* Expanded Attempt Content */}
                {expanded === attempt.id && (
                  <div className="border-t border-slate-100 p-4 dark:border-slate-800">
                    {isReviewed ? (
                      /* REVIEWED VIEW */
                      <ReviewedAttemptView
                        attempt={attempt}
                        exam={selectedExamDoc}
                        questionCache={questionCache}
                        onAmend={() => setAmendingAttempt(attempt)}
                        onReassign={() => setReassigningAttempt(attempt)}
                      />
                    ) : (
                      /* ACTIONABLE AUDITOR REVIEW VIEW (LOW-CLICK) */
                      <AttemptAuditorReview
                        attempt={attempt}
                        exam={selectedExamDoc}
                        questionCache={questionCache}
                        reviewerId={profile?.uid ?? ""}
                        users={users}
                        onFinalized={(finalized) => {
                          patchAttempt(finalized);
                          setMessage({
                            type: "success",
                            text: `Review successfully finalized for ${userName(attempt.agentId)}. Authoritative score: ${finalized.totalMarks} / ${finalized.maxTotalMarks}.`,
                          });
                        }}
                        onSavedDraft={(draft) => {
                          patchAttempt(draft);
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Reassign Exam Modal */}
      {reassigningAttempt && selectedExamDoc && (
        <ReassignModal
          open={!!reassigningAttempt}
          onClose={() => setReassigningAttempt(null)}
          exam={selectedExamDoc}
          sourceAttempt={reassigningAttempt}
          agentName={userName(reassigningAttempt.agentId)}
          auditorId={profile?.uid ?? "auditor"}
          questionsMap={questionCache}
          onSuccess={(assignment: ExamAssignment) => {
            setMessage({
              type: "success",
              text: `Exam reassigned successfully to ${userName(
                reassigningAttempt.agentId
              )} (${assignment.questionCount} questions). New actionable assignment created.`,
            });
            // Update reattempt permissions in local state
            if (selectedExamDoc) {
              const updatedPermissions = {
                ...(selectedExamDoc.reattemptPermissions || {}),
                [reassigningAttempt.agentId]: {
                  agentId: reassigningAttempt.agentId,
                  mode: assignment.reassignmentMode === "wrong_only"
                    ? ("wrong_answers" as const)
                    : assignment.reassignmentMode === "custom"
                    ? ("select_questions" as const)
                    : ("same_questions" as const),
                  questionIds: assignment.questionIds,
                  grantedAt: Date.now(),
                  grantedBy: profile?.uid || "auditor",
                },
              };
              setExams((prev) =>
                prev.map((e) =>
                  e.id === selectedExamDoc.id
                    ? { ...e, reattemptPermissions: updatedPermissions }
                    : e
                )
              );
            }
          }}
        />
      )}

      {/* Amend Scorecard Modal */}
      {amendingAttempt && (
        <AmendScorecardModal
          open={!!amendingAttempt}
          onClose={() => setAmendingAttempt(null)}
          attempt={amendingAttempt}
          reviewerId={profile?.uid ?? ""}
          questionSnapshots={selectedExamDoc?.questionSnapshots ?? questionCache}
          onAmended={(updated) => {
            patchAttempt(updated);
            setMessage({
              type: "success",
              text: `Scorecard amended. Authoritative score: ${updated.totalMarks} / ${updated.maxTotalMarks}.`,
            });
            setAmendingAttempt(null);
          }}
        />
      )}

      {/* Master Scorecard & Attempt Progression Modal */}
      <Modal
        open={!!viewingMergedAgentId}
        onClose={() => setViewingMergedAgentId(null)}
        title={`Exam Master Scorecard — ${userName(viewingMergedAgentId ?? "")}`}
        wide
      >
        {masterScorecardData && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3 dark:border-slate-800">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Master Score</p>
                <p className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  {masterScorecardData.masterPercentage}%
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    ({masterScorecardData.currentMasterScore} / {masterScorecardData.masterTotalMarks} marks)
                  </span>
                </p>
              </div>
              <div className="text-right">
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  {masterScorecardData.reviewedAttemptsCount} reviewed attempt{masterScorecardData.reviewedAttemptsCount === 1 ? "" : "s"}
                </span>
                {masterScorecardData.isCompleted && (
                  <p className="mt-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                    ✓ Exam Requirement Completed
                  </p>
                )}
              </div>
            </div>

            {/* Progression Steps Strip */}
            {masterScorecardData.progression.length > 1 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/40">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                  Attempt Progression History
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {masterScorecardData.progression.map((step, idx) => (
                    <div key={step.attemptId} className="flex items-center gap-2">
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 shadow-sm">
                        <span className="font-bold text-slate-800 dark:text-slate-200">Attempt #{step.attemptNumber}</span>
                        {step.isReattempt && (
                          <span className="ml-1.5 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                            Retake
                          </span>
                        )}
                        <span className="text-slate-400 mx-1.5">|</span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          Current Score: {step.cumulativePercentage}% ({step.cumulativeMasterScore} / {step.masterTotalMarks})
                        </span>
                        {step.progressGain !== null && (
                          <span className="ml-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                            (+{step.progressGain} pts)
                          </span>
                        )}
                      </div>
                      {idx < masterScorecardData.progression.length - 1 && (
                        <span className="text-slate-400 font-bold">→</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Mastered Questions List */}
            <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
              {masterScorecardData.questionMastery.map((rec, idx) => {
                const qSnapshot = selectedExamDoc?.questionSnapshots?.[rec.questionId];
                const qCached = questionCache[rec.questionId];
                const qText = qSnapshot?.questionText || qCached?.questionText || `Question #${idx + 1}`;
                return (
                  <div key={rec.questionId} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-slate-500">#{idx + 1}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {rec.sourceAttemptNumber ? `Best from Attempt #${rec.sourceAttemptNumber}` : "Not attempted"}
                      </span>
                      {rec.isMastered ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                          Mastered
                        </span>
                      ) : (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">
                          Unmastered
                        </span>
                      )}
                      <span
                        className={`ml-auto font-bold ${
                          rec.isMastered ? "text-emerald-600" : "text-amber-600"
                        }`}
                      >
                        {rec.bestMarks} / {rec.maxMarks} marks
                      </span>
                    </div>
                    <p className="mb-1 line-clamp-2 font-medium text-slate-800 dark:text-slate-200">
                      {qText}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end border-t border-slate-100 pt-2 dark:border-slate-800">
              <button type="button" className="btn-secondary" onClick={() => setViewingMergedAgentId(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* =========================================================================
   LOW-CLICK AUDITOR REVIEW PANEL (PART 2 & PART 3)
   ========================================================================= */

function AttemptAuditorReview({
  attempt,
  exam,
  questionCache,
  reviewerId,
  users = [],
  onFinalized,
  onSavedDraft,
}: {
  attempt: ExamAttempt;
  exam?: Exam;
  questionCache: Record<string, Question>;
  reviewerId: string;
  users?: AppUser[];
  onFinalized: (finalized: ExamAttempt) => void;
  onSavedDraft: (draft: ExamAttempt) => void;
}) {
  function userName(uid: string) {
    return users.find((u) => u.uid === uid)?.name ?? uid.slice(0, 8);
  }

  // Score state held locally in component state — initially pre-populated with AI scores or existing marks
  const [scores, setScores] = useState<Record<string, number | "">>(() => {
    const init: Record<string, number | ""> = {};
    for (const ans of attempt.answers) {
      if (ans.marks !== undefined && ans.marks !== null) {
        init[ans.questionId] = ans.marks;
      } else {
        const aiQ = attempt.aiReview?.questionReviews?.find((q) => q.questionId === ans.questionId);
        if (aiQ !== undefined && aiQ.aiSuggestedScore !== undefined) {
          init[ans.questionId] = aiQ.aiSuggestedScore;
        } else if (ans.aiSuggestedScore !== undefined && ans.aiSuggestedScore !== null) {
          init[ans.questionId] = ans.aiSuggestedScore;
        } else {
          init[ans.questionId] = "";
        }
      }
    }
    return init;
  });

  const [comments, setComments] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const ans of attempt.answers) {
      init[ans.questionId] = ans.comments || "";
    }
    return init;
  });

  const [knowledgeGaps, setKnowledgeGaps] = useState<
    Record<string, KnowledgeGapCategory | "">
  >(() => {
    const init: Record<string, KnowledgeGapCategory | ""> = {};
    for (const ans of attempt.answers) {
      init[ans.questionId] = ans.knowledgeGapCategory || "";
    }
    return init;
  });

  const [currentAiReview, setCurrentAiReview] = useState(attempt.aiReview);
  const [runningAi, setRunningAi] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [error, setError] = useState("");
  const [collisionModalOpen, setCollisionModalOpen] = useState(false);
  const [collisionMessage, setCollisionMessage] = useState("");
  const [externalFinalizer, setExternalFinalizer] = useState<string | null>(null);
  const [latestRemoteAttempt, setLatestRemoteAttempt] = useState<ExamAttempt | null>(null);

  // Sync state if attempt doc answers change externally
  useEffect(() => {
    setCurrentAiReview(attempt.aiReview);
  }, [attempt.aiReview]);

  // Listen for concurrent finalization by another auditor (Phase 4B)
  useEffect(() => {
    if (!attempt?.id) return;
    const unsub = onSnapshot(doc(db, "attempts", attempt.id), (snap) => {
      if (!snap.exists()) return;
      const data = { id: snap.id, ...snap.data() } as ExamAttempt;
      if (
        data.status === "reviewed" &&
        data.reviewedBy &&
        data.reviewedBy !== reviewerId &&
        attempt.status !== "reviewed"
      ) {
        setExternalFinalizer(data.reviewedBy);
        setLatestRemoteAttempt(data);
      }
    });
    return () => unsub();
  }, [attempt.id, reviewerId, attempt.status]);

  // When AI review arrives, automatically populate all unscored fields with AI suggested scores
  useEffect(() => {
    if (currentAiReview?.questionReviews) {
      setScores((prev) => {
        const next = { ...prev };
        let updated = false;
        for (const qr of currentAiReview.questionReviews) {
          if (next[qr.questionId] === "" || next[qr.questionId] === undefined) {
            next[qr.questionId] = qr.aiSuggestedScore;
            updated = true;
          }
        }
        return updated ? next : prev;
      });
    }
  }, [currentAiReview]);

  // Compute live totals
  const { currentTotal, maxTotal, scoredCount, allScored } = useMemo(() => {
    let cur = 0;
    let max = 0;
    let scored = 0;

    for (const ans of attempt.answers) {
      const val = scores[ans.questionId];
      if (val !== "" && val !== undefined) {
        cur += Number(val);
        scored += 1;
      }
      max += ans.maxMarks;
    }

    return {
      currentTotal: cur,
      maxTotal: max,
      scoredCount: scored,
      allScored: scored === attempt.answers.length,
    };
  }, [attempt.answers, scores]);

  const scorePercentage = maxTotal > 0 ? Math.round((currentTotal / maxTotal) * 100) : 0;

  // Run or regenerate AI Review
  async function handleRunAiReview(forceRegenerate = false) {
    try {
      setRunningAi(true);
      setError("");

      const resolvedQuestions: Question[] = attempt.answers.map((ans) => {
        const live = questionCache[ans.questionId];
        const examSnapshot = exam?.questionSnapshots?.[ans.questionId];
        const snap = ans.questionSnapshot;
        return {
          ...(snap || live || examSnapshot || {}),
          id: ans.questionId,
          questionText: snap?.questionText || live?.questionText || examSnapshot?.questionText || "Question",
          type: snap?.type || live?.type || examSnapshot?.type || "descriptive",
          expectedAnswer:
            live?.expectedAnswer ||
            examSnapshot?.expectedAnswer ||
            snap?.expectedAnswer ||
            "",
          correctOptionIndex:
            live?.correctOptionIndex ??
            examSnapshot?.correctOptionIndex ??
            snap?.correctOptionIndex,
          orderItems: live?.orderItems || examSnapshot?.orderItems || snap?.orderItems,
          options: live?.options || examSnapshot?.options || snap?.options,
          notes: live?.notes || examSnapshot?.notes || snap?.notes || "",
        } as Question;
      });

      // Force refresh the auth token to ensure it hasn't expired
      const idToken = await auth.currentUser?.getIdToken(true);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (idToken) {
        headers["Authorization"] = `Bearer ${idToken}`;
      }

      const res = await fetch("/api/ai/review", {
        method: "POST",
        headers,
        body: JSON.stringify({
          attemptId: attempt.id,
          attempt,
          questions: resolvedQuestions,
          forceRegenerate,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate AI review");
      }

      const data = await res.json();
      if (data.aiReview) {
        setCurrentAiReview(data.aiReview);
        // Persist directly from the authenticated auditor client
        try {
          await saveAiReviewToAttempt(attempt.id, data.aiReview);
        } catch (saveErr) {
          console.warn("[AttemptAuditorReview] Failed to persist AI review:", saveErr);
        }
      }
    } catch (err: any) {
      console.error("[AttemptAuditorReview] AI Review error:", err);
      setError(err.message || "AI review generation encountered an issue. Manual review is available.");
    } finally {
      setRunningAi(false);
    }
  }

  // Auto-run AI review on mount if not yet generated
  useEffect(() => {
    if (
      !attempt.aiReview &&
      (attempt.status === "submitted" || attempt.status === "review_in_progress")
    ) {
      handleRunAiReview(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt.id]);

  // One-click: Accept All AI Suggested Scores
  function handleAcceptAllAi() {
    if (!currentAiReview?.questionReviews) return;

    setScores((prev) => {
      const next = { ...prev };
      for (const qr of currentAiReview.questionReviews) {
        next[qr.questionId] = qr.aiSuggestedScore;
      }
      return next;
    });
    setDraftSaved(false);
  }

  // One-click: Accept individual AI Suggested Score
  function handleAcceptAiScore(questionId: string, aiScore: number) {
    setScores((prev) => ({
      ...prev,
      [questionId]: aiScore,
    }));
    setDraftSaved(false);
  }

  // Save draft scores (low-click single action)
  async function handleSaveDraft() {
    try {
      setSavingDraft(true);
      setError("");
      setDraftSaved(false);

      const batchMap: Record<string, { marks?: number; comments?: string; knowledgeGapCategory?: KnowledgeGapCategory }> = {};
      for (const ans of attempt.answers) {
        const val = scores[ans.questionId];
        batchMap[ans.questionId] = {
          marks: val !== "" ? Number(val) : undefined,
          comments: comments[ans.questionId] || "",
          knowledgeGapCategory: knowledgeGaps[ans.questionId] || undefined,
        };
      }

      const updated = await saveAllReviewDraftScores(attempt.id, reviewerId, batchMap);
      setDraftSaved(true);
      onSavedDraft(updated);
    } catch (err: any) {
      console.error("Failed to save draft scores:", err);
      setError(err.message || "Failed to save draft review.");
    } finally {
      setSavingDraft(false);
    }
  }

  // Finalize review (one-click single transaction)
  async function handleFinalize() {
    if (!allScored || finalizing) return;

    try {
      setFinalizing(true);
      setError("");

      const auditorScores: Record<string, number> = {};
      const auditorComments: Record<string, string> = {};
      const knowledgeGapsMap: Record<string, KnowledgeGapCategory> = {};

      for (const ans of attempt.answers) {
        const val = scores[ans.questionId];
        if (val === "" || val === undefined) {
          throw new Error(`Question ${ans.questionId} is still unscored.`);
        }
        auditorScores[ans.questionId] = Number(val);
        auditorComments[ans.questionId] = comments[ans.questionId] || "";
        if (knowledgeGaps[ans.questionId]) {
          knowledgeGapsMap[ans.questionId] = knowledgeGaps[ans.questionId] as KnowledgeGapCategory;
        }
      }

      const finalized = await finalizeAttemptReview({
        attemptId: attempt.id,
        reviewerId,
        auditorScores,
        auditorComments,
        knowledgeGaps: knowledgeGapsMap,
      });

      onFinalized(finalized);
    } catch (err: any) {
      console.error("Failed to finalize review:", err);
      const msg = err.message || "";
      if (msg.includes("Review Conflict")) {
        setCollisionMessage(msg);
        setCollisionModalOpen(true);
      } else {
        setError(msg || "Failed to finalize review. Please retry.");
      }
    } finally {
      setFinalizing(false);
    }
  }

  const aiReviewsMap = useMemo(() => {
    const map = new Map<string, any>();
    (currentAiReview?.questionReviews || []).forEach((qr: any) => {
      map.set(qr.questionId, qr);
    });
    return map;
  }, [currentAiReview]);

  return (
    <div className="space-y-5">
      {/* Live Concurrent Finalization Alert (Phase 4B) */}
      {externalFinalizer && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              <strong>Review Collision Alert:</strong> Another auditor ({userName(externalFinalizer)}) finalized this attempt while you were reviewing.
            </span>
          </div>
          {latestRemoteAttempt && (
            <button
              type="button"
              className="rounded bg-amber-600 px-3 py-1 font-semibold text-white hover:bg-amber-700 transition-colors"
              onClick={() => onFinalized(latestRemoteAttempt)}
            >
              Load Finalized Review
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* AI REVIEW LAYER AT TOP */}
      <div className="rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50/70 to-brand-50/50 p-4 dark:border-indigo-900/30 dark:from-indigo-950/20 dark:to-brand-950/20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  AI-Assisted First-Pass Review
                </h4>
                {currentAiReview?.status === "complete" ? (
                  <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" /> Completed
                  </span>
                ) : runningAi || currentAiReview?.status === "processing" ? (
                  <span className="flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                    <Loader2 className="h-3 w-3 animate-spin" /> Reviewing...
                  </span>
                ) : currentAiReview?.status === "failed" ? (
                  <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    <AlertTriangle className="h-3 w-3" /> Failed
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    Pending
                  </span>
                )}
              </div>

              {currentAiReview?.status === "complete" && (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  Suggested Score:{" "}
                  <strong className="text-indigo-700 dark:text-indigo-300">
                    {currentAiReview.overallSuggestedPercentage}%
                  </strong>{" "}
                  ({currentAiReview.overallSuggestedScore} / {currentAiReview.maxPossibleScore} marks)
                </p>
              )}
            </div>
          </div>

          {/* AI Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {currentAiReview?.status === "complete" ? (
              <>
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
                  onClick={handleAcceptAllAi}
                >
                  <Sparkles className="h-3.5 w-3.5" /> Accept All AI Scores
                </button>
                <button
                  type="button"
                  className="btn-secondary flex items-center gap-1.5 text-xs font-medium"
                  onClick={() => handleRunAiReview(true)}
                  disabled={runningAi}
                >
                  {runningAi ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                  Regenerate AI Review
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-primary flex items-center gap-1.5 text-xs font-medium"
                onClick={() => handleRunAiReview(false)}
                disabled={runningAi}
              >
                {runningAi ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing Answers...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" /> Run AI Review
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* QUESTION LIST WITH INLINE AUDITOR INPUTS */}
      <div className="space-y-4">
        {attempt.answers.map((ans, idx) => {
          const live = questionCache[ans.questionId];
          const examSnapshot = exam?.questionSnapshots?.[ans.questionId];
          const q = ans.questionSnapshot
            ? {
                ...ans.questionSnapshot,
                expectedAnswer:
                  live?.expectedAnswer ??
                  examSnapshot?.expectedAnswer ??
                  ans.questionSnapshot.expectedAnswer,
                correctOptionIndex:
                  live?.correctOptionIndex ??
                  examSnapshot?.correctOptionIndex ??
                  ans.questionSnapshot.correctOptionIndex,
              }
            : live || examSnapshot;

          const questionText =
            q?.questionText ||
            live?.questionText ||
            examSnapshot?.questionText ||
            `Question ${idx + 1}`;

          const expectedAnswer =
            q?.expectedAnswer ||
            live?.expectedAnswer ||
            examSnapshot?.expectedAnswer ||
            "(Reference answer unavailable)";

          const aiReview = aiReviewsMap.get(ans.questionId);
          const currentMarks = scores[ans.questionId];
          const numericMarks = currentMarks === "" ? undefined : Number(currentMarks);
          const needsKnowledgeGap = numericMarks !== undefined && numericMarks < ans.maxMarks;

          return (
            <div
              key={ans.questionId}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-all dark:border-slate-800 dark:bg-slate-900"
            >
              {/* Question Header */}
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-500">Q{idx + 1}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 uppercase dark:bg-slate-800 dark:text-slate-300">
                      {q?.type || "descriptive"}
                    </span>
                    <span className="text-xs text-slate-400">Max: {ans.maxMarks} marks</span>
                  </div>
                  <div className="mt-1">
                    <QuestionContent
                      content={questionText}
                      className="text-sm font-semibold text-slate-900 dark:text-slate-100"
                    />
                  </div>
                </div>

                {/* Score Status Badge */}
                <Badge
                  color={
                    numericMarks === ans.maxMarks
                      ? "green"
                      : numericMarks === 0
                      ? "red"
                      : numericMarks !== undefined
                      ? "amber"
                      : "slate"
                  }
                >
                  {numericMarks === undefined
                    ? "Unscored"
                    : `${numericMarks} / ${ans.maxMarks} marks`}
                </Badge>
              </div>

              {/* Expected vs Agent Answer */}
              <div className="mb-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-xs">
                <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
                  <p className="mb-1 font-bold uppercase tracking-wider text-slate-400">Expected Answer</p>
                  <p className="text-slate-700 dark:text-slate-300">{expectedAnswer}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60">
                  <p className="mb-1 font-bold uppercase tracking-wider text-slate-400">Agent Answer</p>
                  <AnswerDisplay question={q as Question} agentAnswer={ans.agentAnswer} />
                </div>
              </div>

              {/* AI SUGGESTION LAYER (IF AVAILABLE) */}
              {aiReview && (
                <div className="mb-3 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 text-xs dark:border-indigo-900/30 dark:bg-indigo-950/20">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100/70 pb-2 dark:border-indigo-900/30">
                    <div className="flex flex-wrap items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                      <span className="font-bold text-indigo-900 dark:text-indigo-200">
                        AI Suggested: {aiReview.aiSuggestedScore} / {aiReview.maxScore} marks
                      </span>
                      {aiReview.understandingScore !== undefined && (
                        <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300">
                          Understanding: {aiReview.understandingScore} / 10
                        </span>
                      )}
                      {aiReview.verdict && (
                        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {aiReview.verdict.replace("_", " ")}
                        </span>
                      )}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          aiReview.confidence === "high"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : aiReview.confidence === "medium"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                            : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        }`}
                      >
                        {aiReview.confidence.toUpperCase()} Confidence
                      </span>
                    </div>

                    {numericMarks !== aiReview.aiSuggestedScore && (
                      <button
                        type="button"
                        className="rounded bg-indigo-600 px-2 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-indigo-700 transition-colors"
                        onClick={() => handleAcceptAiScore(ans.questionId, aiReview.aiSuggestedScore)}
                      >
                        Reset to AI Score
                      </button>
                    )}
                  </div>

                  <p className="mt-2 text-slate-700 dark:text-slate-300">{aiReview.reasoning}</p>

                  {Array.isArray(aiReview.missingPoints) && aiReview.missingPoints.length > 0 && (
                    <div className="mt-1.5 text-rose-700 dark:text-rose-300">
                      <span className="font-semibold">Missing:</span>
                      <ul className="ml-4 list-disc space-y-0.5">
                        {aiReview.missingPoints.map((pt: string, i: number) => (
                          <li key={i}>{pt}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {Array.isArray(aiReview.detectedIssues) && aiReview.detectedIssues.length > 0 && (
                    <div className="mt-1.5 text-amber-700 dark:text-amber-300">
                      <span className="font-semibold">Detected Issues:</span>
                      <ul className="ml-4 list-disc space-y-0.5">
                        {aiReview.detectedIssues.map((iss: string, i: number) => (
                          <li key={i}>{iss}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* AUDITOR INLINE SCORE & FEEDBACK ROW */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[130px_1fr_200px]">
                {/* Score Input */}
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Auditor Score / {ans.maxMarks}
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={ans.maxMarks}
                    className="input text-sm font-bold"
                    placeholder="Score"
                    value={scores[ans.questionId] ?? ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setScores((prev) => ({
                        ...prev,
                        [ans.questionId]: val === "" ? "" : Number(val),
                      }));
                      setDraftSaved(false);
                    }}
                  />
                </div>

                {/* Comments Input */}
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Auditor Comments / Feedback
                  </label>
                  <input
                    type="text"
                    className="input text-sm"
                    placeholder="Optional notes or feedback..."
                    value={comments[ans.questionId] || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setComments((prev) => ({
                        ...prev,
                        [ans.questionId]: val,
                      }));
                      setDraftSaved(false);
                    }}
                  />
                </div>

                {/* Knowledge Gap Dropdown */}
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Knowledge Gap
                  </label>
                  <select
                    className="input text-xs"
                    value={knowledgeGaps[ans.questionId] || ""}
                    disabled={!needsKnowledgeGap}
                    onChange={(e) => {
                      const val = e.target.value as KnowledgeGapCategory | "";
                      setKnowledgeGaps((prev) => ({
                        ...prev,
                        [ans.questionId]: val,
                      }));
                      setDraftSaved(false);
                    }}
                  >
                    <option value="">
                      {needsKnowledgeGap ? "Select category..." : "Not required"}
                    </option>
                    {KNOWLEDGE_GAPS.map((gap) => (
                      <option key={gap} value={gap}>
                        {gap}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ONE FINAL SUBMIT STICKY BAR (PART 3: LOW-CLICK AUDITOR REVIEW) */}
      <div className="sticky bottom-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Authoritative Score: {currentTotal} / {maxTotal} ({scorePercentage}%)
              </span>
              {draftSaved && (
                <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3.5 w-3.5" /> Draft Saved
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500">
              {allScored
                ? "All questions scored. Ready for final submission."
                : `${attempt.answers.length - scoredCount} question(s) still need an auditor score.`}
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              className="btn-secondary flex items-center gap-1.5 text-xs font-semibold"
              onClick={handleSaveDraft}
              disabled={savingDraft || finalizing}
            >
              <Save className="h-3.5 w-3.5" />
              {savingDraft ? "Saving..." : "Save Draft"}
            </button>

            <button
              type="button"
              className="btn-primary flex items-center gap-1.5 text-xs font-semibold px-4 py-2"
              disabled={!allScored || finalizing}
              onClick={handleFinalize}
            >
              {finalizing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Submitting Review...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Final Submit
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Review Collision Alert Modal (Phase 4B) */}
      <Modal
        open={collisionModalOpen}
        onClose={() => setCollisionModalOpen(false)}
        title="Review Conflict Detected"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <p>{collisionMessage || "Another auditor has already finalized this review. To prevent overwriting finalized scores, your submission was blocked."}</p>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            You can load the authoritative finalized scores to inspect the other auditor&apos;s evaluation without losing your current session.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={() => setCollisionModalOpen(false)}
            >
              Dismiss
            </button>
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => {
                setCollisionModalOpen(false);
                if (latestRemoteAttempt) {
                  onFinalized(latestRemoteAttempt);
                } else {
                  window.location.reload();
                }
              }}
            >
              Refresh & View Finalized Scores
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* =========================================================================
   READ-ONLY VIEW FOR ALREADY REVIEWED ATTEMPTS
   ========================================================================= */

function ReviewedAttemptView({
  attempt,
  exam,
  questionCache,
  onAmend,
  onReassign,
}: {
  attempt: ExamAttempt;
  exam?: Exam;
  questionCache: Record<string, Question>;
  onAmend: () => void;
  onReassign: () => void;
}) {
  return (
    <div className="space-y-4">
      {/* Review Completed Summary Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-200 bg-green-50/80 p-4 dark:border-green-800/40 dark:bg-green-950/20">
        <div className="flex items-center gap-2.5">
          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
          <div>
            <p className="font-bold text-green-900 dark:text-green-200">
              Review Finalized · Official Score: {attempt.totalMarks ?? 0} / {attempt.maxTotalMarks ?? 0}
              {attempt.originalTotalMarks !== undefined && attempt.originalTotalMarks !== attempt.totalMarks && (
                <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                  (Initial: {attempt.originalTotalMarks} / {attempt.maxTotalMarks ?? 0})
                </span>
              )}
            </p>
            <p className="text-xs text-green-700 dark:text-green-400">
              Reviewed by {attempt.reviewedBy || "Auditor"}{" "}
              {attempt.reviewedAt ? `on ${new Date(attempt.reviewedAt).toLocaleString()}` : ""}
              {attempt.amendedAt && (
                <span className="ml-2 font-medium text-amber-700 dark:text-amber-400">
                  · Amended by {attempt.amendedBy || "Auditor"} on {new Date(attempt.amendedAt).toLocaleString()}
                  {attempt.amendmentReason ? ` ("${attempt.amendmentReason}")` : ""}
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-secondary flex items-center gap-1.5 text-xs font-semibold shadow-sm"
            onClick={onAmend}
          >
            <Pencil className="h-3.5 w-3.5 text-brand-600" /> Amend Scorecard
          </button>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5 text-xs font-semibold shadow-sm"
            onClick={onReassign}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reassign Exam
          </button>
        </div>
      </div>

      {/* Read-Only Question List */}
      <div className="space-y-3">
        {attempt.answers.map((ans, idx) => {
          const live = questionCache[ans.questionId];
          const examSnapshot = exam?.questionSnapshots?.[ans.questionId];
          const q = ans.questionSnapshot || live || examSnapshot;
          const aiRev = attempt.aiReview?.questionReviews?.find(
            (qr) => qr.questionId === ans.questionId
          );

          return (
            <div
              key={ans.questionId}
              className="rounded-xl border border-slate-200 p-3.5 text-xs dark:border-slate-800"
            >
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-mono font-bold text-slate-500">Q{idx + 1}</span>
                <div className="flex items-center gap-2">
                  {ans.originalFinalScore !== undefined && ans.originalFinalScore !== ans.marks && (
                    <span className="text-[10px] text-slate-400 line-through">
                      Initial: {ans.originalFinalScore}
                    </span>
                  )}
                  {aiRev && (
                    <span className="rounded bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                      AI: {aiRev.aiSuggestedScore} / {aiRev.maxScore}
                    </span>
                  )}
                  <span
                    className={`font-bold ${
                      (ans.marks ?? 0) >= ans.maxMarks
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    Auditor Score: {ans.marks ?? 0} / {ans.maxMarks} marks
                  </span>
                </div>
              </div>

              <p className="font-medium text-slate-800 dark:text-slate-200">
                {q?.questionText || `Question #${idx + 1}`}
              </p>

              <div className="mt-2 rounded bg-slate-50 p-2 dark:bg-slate-800/50">
                <span className="font-semibold text-slate-400 uppercase text-[10px]">Agent Answer:</span>
                <p className="mt-0.5 text-slate-700 dark:text-slate-300">
                  {ans.agentAnswer || "(No answer provided)"}
                </p>
              </div>

              {ans.comments && (
                <div className="mt-2 rounded bg-brand-50/50 p-2 text-brand-900 dark:bg-brand-950/30 dark:text-brand-200">
                  <span className="font-semibold uppercase text-[10px]">Auditor Feedback:</span>
                  <p className="mt-0.5">{ans.comments}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
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