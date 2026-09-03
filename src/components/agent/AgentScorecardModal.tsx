"use client";

import { useState, useEffect, useRef } from "react";
import type { ExamAttempt, Question } from "@/types";
import { Modal, Badge } from "@/components/ui/Primitives";
import { QuestionContent } from "@/components/questions/QuestionContent";
import { AnswerDisplay } from "@/components/questions/AnswerDisplay";
import { getExam } from "@/lib/exams";
import { deriveCleanTitle } from "@/components/exam-builder/ExamListScreen";
import { Award, Clock, MessageSquare } from "lucide-react";

interface AgentScorecardModalProps {
  open: boolean;
  onClose: () => void;
  attempt: ExamAttempt;
  examName?: string;
  questionSnapshots?: Record<string, Question>;
}

export function AgentScorecardModal({
  open,
  onClose,
  attempt,
  examName,
  questionSnapshots,
}: AgentScorecardModalProps) {
  const isReviewed = attempt.status === "reviewed";
  const total = attempt.totalMarks ?? 0;
  const max = attempt.maxTotalMarks ?? attempt.answers.reduce((sum, a) => sum + a.maxMarks, 0);
  const pct = max > 0 ? Math.round((total / max) * 100) : 0;
  const isPerfect = isReviewed && max > 0 && total === max;

  // Local snapshot and title state with in-memory caching to minimize Firestore usage
  const [examSnapshots, setExamSnapshots] = useState<Record<string, Question>>(
    questionSnapshots ?? {}
  );
  const [resolvedExamName, setResolvedExamName] = useState<string | undefined>(examName);
  const fetchedExamIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (questionSnapshots) {
      setExamSnapshots((prev) => ({ ...prev, ...questionSnapshots }));
    }
  }, [questionSnapshots]);

  useEffect(() => {
    if (examName && examName !== "Exam") {
      setResolvedExamName(examName);
    }
  }, [examName]);

  // If any answer is missing frozen questionText, lazily retrieve the original exam document once
  useEffect(() => {
    if (!open || !attempt) return;

    const missingSnapshot = attempt.answers.some(
      (ans) => !ans.questionSnapshot?.questionText && !examSnapshots[ans.questionId]?.questionText
    );

    if (missingSnapshot && attempt.examId && !fetchedExamIdsRef.current.has(attempt.examId)) {
      fetchedExamIdsRef.current.add(attempt.examId);
      let active = true;
      getExam(attempt.examId)
        .then((examDoc) => {
          if (!active || !examDoc) return;
          if (examDoc.questionSnapshots) {
            setExamSnapshots((prev) => ({
              ...prev,
              ...examDoc.questionSnapshots,
            }));
          }
          if (!resolvedExamName || resolvedExamName === "Exam") {
            setResolvedExamName(deriveCleanTitle(examDoc, 0).title);
          }
        })
        .catch((err) => {
          console.warn("Could not load original exam snapshots for attempt:", err);
        });

      return () => {
        active = false;
      };
    }
  }, [open, attempt, examSnapshots, resolvedExamName]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        isReviewed
          ? `Scorecard — ${resolvedExamName || examName || "Exam"} (Attempt #${attempt.attemptNumber})`
          : `Submitted Answers — ${resolvedExamName || examName || "Exam"} (Attempt #${attempt.attemptNumber})`
      }
      wide
    >
      <div className="space-y-4 text-xs">
        {/* Header Banner */}
        {isReviewed ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand-200 bg-brand-50/50 p-4 dark:border-brand-800/60 dark:bg-brand-950/20">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
                <Award className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">
                  Official Score
                </p>
                <p className="text-xl font-bold text-slate-900 dark:text-slate-100">
                  {total} / {max} <span className="text-sm font-medium text-brand-600">({pct}%)</span>
                </p>
              </div>
            </div>

            <div className="text-right">
              <Badge color={isPerfect ? "green" : pct >= 70 ? "brand" : "amber"}>
                {isPerfect ? "Perfect Score" : pct >= 70 ? "Passed" : "Needs Improvement"}
              </Badge>
              {attempt.reviewedAt && (
                <p className="mt-1 text-[11px] text-slate-400">
                  Reviewed on {new Date(attempt.reviewedAt).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300">
            <Clock className="h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Your exam has been submitted and is currently awaiting review by your auditor. Answers shown below are read-only.
            </span>
          </div>
        )}

        {/* Questions & Feedback List */}
        <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
          {attempt.answers.map((ans, idx) => {
            // DATA PRIORITY:
            // 1. Frozen snapshot inside the answer object (ans.questionSnapshot)
            // 2. Snapshot from the exam's original questionSnapshots map
            // 3. Fallback to passed questionSnapshots prop
            const q = ans.questionSnapshot ?? examSnapshots[ans.questionId] ?? questionSnapshots?.[ans.questionId];
            const rawQuestionText = q?.questionText?.trim();
            // Never substitute generic "Question 1" as question content
            const questionContent = rawQuestionText || "(Question content unavailable from historical snapshot)";
            const hasMarks = ans.marks !== undefined;
            const fullMarks = hasMarks && ans.marks === ans.maxMarks;

            return (
              <div
                key={ans.questionId}
                className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <span className="font-mono font-bold text-slate-500">Question {idx + 1}</span>
                    <QuestionContent
                      content={questionContent}
                      className={`mt-1 font-medium ${
                        rawQuestionText
                          ? "text-slate-800 dark:text-slate-200"
                          : "italic text-slate-400 dark:text-slate-500"
                      }`}
                    />
                  </div>

                  {isReviewed && hasMarks && (
                    <div className="shrink-0 text-right">
                      <span
                        className={`font-mono text-xs font-bold ${
                          fullMarks
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {ans.marks} / {ans.maxMarks} marks
                      </span>
                    </div>
                  )}
                </div>

                {/* Candidate's Submitted Answer */}
                <div className="mb-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Your Response:
                  </span>
                  {q ? (
                    <AnswerDisplay question={q} agentAnswer={ans.agentAnswer} />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm">{ans.agentAnswer || "(no answer)"}</p>
                  )}
                </div>

                {/* Auditor Feedback Comment */}
                {isReviewed && ans.comments && (
                  <div className="flex items-start gap-2 rounded-lg border border-brand-100 bg-brand-50/40 p-2 dark:border-brand-900/40 dark:bg-brand-950/20">
                    <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
                    <div>
                      <span className="font-semibold text-brand-900 dark:text-brand-300">
                        Auditor Feedback:
                      </span>
                      <p className="mt-0.5 text-slate-700 dark:text-slate-300">{ans.comments}</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className="flex justify-end border-t border-slate-100 pt-3 dark:border-slate-800">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}