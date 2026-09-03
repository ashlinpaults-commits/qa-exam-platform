"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Target,
  Users,
  X,
} from "lucide-react";

import type {
  ExamAttempt,
  Question,
} from "@/types";

import type {
  AgentCompetency,
} from "@/lib/competency";

interface ModuleDrilldownModalProps {
  moduleName: string;
  attempts: ExamAttempt[];
  questions: Question[];
  competencies: AgentCompetency[];
  onClose: () => void;
  onOpenAgent: (competency: AgentCompetency) => void;
}

interface AgentModulePerformance {
  agentId: string;
  competency: AgentCompetency;
  score: number;
  questionsMeasured: number;
  gaps: number;
}

interface MissedQuestion {
  questionId: string;
  questionText: string;
  asked: number;
  missed: number;
  missPct: number;
}

export function ModuleDrilldownModal({
  moduleName,
  attempts,
  questions,
  competencies,
  onClose,
  onOpenAgent,
}: ModuleDrilldownModalProps) {
  const analytics = useMemo(() => {
    const moduleQuestions = questions.filter(
      (question) => question.module === moduleName
    );

    const moduleQuestionIds = new Set(
      moduleQuestions.map((question) => question.id)
    );

    const questionMap = new Map(
      moduleQuestions.map((question) => [
        question.id,
        question,
      ])
    );

    /*
     * =======================================================
     * CURRENT MODULE KNOWLEDGE
     *
     * Latest reviewed answer for each agent + question.
     *
     * This matches the philosophy used by the main Analytics
     * dashboard:
     *
     * Current competency = latest reviewed knowledge.
     * =======================================================
     */

    const reviewedAttempts = [...attempts]
      .filter((attempt) => attempt.status === "reviewed")
      .sort(
        (a, b) =>
          getAttemptTimestamp(a) -
          getAttemptTimestamp(b)
      );

    const latestAnswers = new Map<
      string,
      {
        agentId: string;
        questionId: string;
        marks: number;
        maxMarks: number;
      }
    >();

    reviewedAttempts.forEach((attempt) => {
      attempt.answers.forEach((answer) => {
        if (answer.marks === undefined) return;

        if (!moduleQuestionIds.has(answer.questionId)) {
          return;
        }

        const key = `${attempt.agentId}::${answer.questionId}`;

        latestAnswers.set(key, {
          agentId: attempt.agentId,
          questionId: answer.questionId,
          marks: answer.marks,
          maxMarks: answer.maxMarks,
        });
      });
    });

    /*
     * =======================================================
     * TEAM MODULE SCORE
     * =======================================================
     */

    let teamMarks = 0;
    let teamMaxMarks = 0;

    latestAnswers.forEach((answer) => {
      teamMarks += answer.marks;
      teamMaxMarks += answer.maxMarks;
    });

    const teamScore =
      teamMaxMarks > 0
        ? Math.round(
            (teamMarks / teamMaxMarks) * 100
          )
        : null;

    /*
     * =======================================================
     * AGENT MODULE PERFORMANCE
     * =======================================================
     */

    const agentMap = new Map<
      string,
      {
        marks: number;
        maxMarks: number;
        questions: number;
        gaps: number;
      }
    >();

    latestAnswers.forEach((answer) => {
      const current = agentMap.get(answer.agentId) ?? {
        marks: 0,
        maxMarks: 0,
        questions: 0,
        gaps: 0,
      };

      current.marks += answer.marks;
      current.maxMarks += answer.maxMarks;
      current.questions += 1;

      const score =
        answer.maxMarks > 0
          ? (answer.marks / answer.maxMarks) * 100
          : 0;

      if (score < 70) {
        current.gaps += 1;
      }

      agentMap.set(answer.agentId, current);
    });

    const agentPerformance: AgentModulePerformance[] =
      Array.from(agentMap.entries())
        .map(([agentId, value]) => {
          const competency = competencies.find(
            (item) => item.agentId === agentId
          );

          if (!competency) return null;

          return {
            agentId,
            competency,
            score:
              value.maxMarks > 0
                ? Math.round(
                    (value.marks / value.maxMarks) * 100
                  )
                : 0,
            questionsMeasured: value.questions,
            gaps: value.gaps,
          };
        })
        .filter(
          (
            item
          ): item is AgentModulePerformance =>
            item !== null
        )
        .sort((a, b) => a.score - b.score);

    const agentsAssessed = agentPerformance.length;

    const agentsBelowTarget = agentPerformance.filter(
      (agent) => agent.score < 70
    ).length;

    /*
     * =======================================================
     * QUESTIONS CURRENTLY MEASURED
     *
     * Unique module questions that currently have at least
     * one reviewed answer.
     * =======================================================
     */

    const measuredQuestionIds = new Set<string>();

    latestAnswers.forEach((answer) => {
      measuredQuestionIds.add(answer.questionId);
    });

    const questionsMeasured =
      measuredQuestionIds.size;

    /*
     * =======================================================
     * PERSISTENT GAPS
     *
     * Reuse competency engine results rather than creating
     * another definition of persistent knowledge gaps.
     * =======================================================
     */

    const persistentGapQuestionIds = new Set<string>();

    competencies.forEach((competency) => {
      competency.persistentGaps
        .filter((gap) => gap.module === moduleName)
        .forEach((gap) => {
          persistentGapQuestionIds.add(
            `${competency.agentId}::${gap.questionId}`
          );
        });
    });

    const persistentGaps =
      persistentGapQuestionIds.size;

    /*
     * =======================================================
     * HISTORICAL MISSED QUESTIONS
     *
     * Unlike current competency, this intentionally uses ALL
     * reviewed attempts.
     *
     * This tells QA which questions historically create the
     * most trouble.
     * =======================================================
     */

    const missedMap = new Map<
      string,
      {
        asked: number;
        missed: number;
      }
    >();

    reviewedAttempts.forEach((attempt) => {
      attempt.answers.forEach((answer) => {
        if (answer.marks === undefined) return;

        if (!moduleQuestionIds.has(answer.questionId)) {
          return;
        }

        const current =
          missedMap.get(answer.questionId) ?? {
            asked: 0,
            missed: 0,
          };

        current.asked += 1;

        const score =
          answer.maxMarks > 0
            ? (answer.marks / answer.maxMarks) * 100
            : 0;

        if (score < 70) {
          current.missed += 1;
        }

        missedMap.set(answer.questionId, current);
      });
    });

    const missedQuestions: MissedQuestion[] =
      Array.from(missedMap.entries())
        .map(([questionId, value]) => ({
          questionId,
          questionText:
            questionMap.get(questionId)?.questionText ??
            "Unknown question",
          asked: value.asked,
          missed: value.missed,
          missPct:
            value.asked > 0
              ? Math.round(
                  (value.missed / value.asked) * 100
                )
              : 0,
        }))
        .filter((question) => question.missed > 0)
        .sort((a, b) => {
          if (b.missed !== a.missed) {
            return b.missed - a.missed;
          }

          return b.missPct - a.missPct;
        })
        .slice(0, 10);

    /*
     * =======================================================
     * KNOWLEDGE GAP CATEGORIES
     * =======================================================
     */

    const gapCategories: {
      category: string;
      count: number;
    }[] = [];

    return {
      teamScore,
      agentsAssessed,
      agentsBelowTarget,
      questionsMeasured,
      persistentGaps,
      agentPerformance,
      missedQuestions,
      gapCategories,
    };
  }, [
    moduleName,
    attempts,
    questions,
    competencies,
  ]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(event) =>
          event.stopPropagation()
        }
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
      >
        {/* HEADER */}

        <div className="sticky top-0 z-20 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5 dark:border-slate-700 dark:bg-slate-900">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Module Analysis
            </p>

            <h2 className="mt-1 text-xl font-semibold">
              {moduleName}
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Current competency and historical knowledge
              gaps for this module.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-7 p-6">
          {/* SUMMARY */}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <ModuleStat
              label="Team Competency"
              value={
                analytics.teamScore !== null
                  ? `${analytics.teamScore}%`
                  : "-"
              }
            />

            <ModuleStat
              label="Agents Assessed"
              value={String(
                analytics.agentsAssessed
              )}
            />

            <ModuleStat
              label="Below 70%"
              value={String(
                analytics.agentsBelowTarget
              )}
            />

            <ModuleStat
              label="Questions Measured"
              value={String(
                analytics.questionsMeasured
              )}
            />

            <ModuleStat
              label="Persistent Gaps"
              value={String(
                analytics.persistentGaps
              )}
            />
          </div>

          {/* AGENT PERFORMANCE */}

          <section>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-slate-500" />

              <h3 className="font-semibold">
                Agent Performance
              </h3>
            </div>

            <p className="mt-1 text-sm text-slate-500">
              Current module competency for each assessed
              agent. Lowest scores appear first.
            </p>

            {analytics.agentPerformance.length ===
            0 ? (
              <p className="mt-4 text-sm text-slate-400">
                No reviewed agent data for this module.
              </p>
            ) : (
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[650px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
                      <tr>
                        <th className="px-4 py-3">
                          Agent
                        </th>

                        <th className="px-4 py-3">
                          Competency
                        </th>

                        <th className="px-4 py-3">
                          Questions
                        </th>

                        <th className="px-4 py-3">
                          Current Gaps
                        </th>

                        <th className="w-10 px-3 py-3" />
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {analytics.agentPerformance.map(
                        (agent) => (
                          <tr
                            key={agent.agentId}
                            onClick={() =>
                              onOpenAgent(
                                agent.competency
                              )
                            }
                            className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
                          >
                            <td className="px-4 py-3">
                              <p className="font-medium text-slate-900 dark:text-white">
                                {agent.competency.agent
                                  ?.name ??
                                  agent.agentId.slice(
                                    0,
                                    10
                                  )}
                              </p>

                              {agent.competency.agent
                                ?.email && (
                                <p className="mt-0.5 text-xs text-slate-400">
                                  {
                                    agent.competency
                                      .agent.email
                                  }
                                </p>
                              )}
                            </td>

                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <span className="min-w-[42px] font-semibold">
                                  {agent.score}%
                                </span>

                                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                  <div
                                    className="h-full rounded-full bg-brand-500"
                                    style={{
                                      width: `${Math.min(
                                        100,
                                        Math.max(
                                          0,
                                          agent.score
                                        )
                                      )}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            </td>

                            <td className="px-4 py-3">
                              {
                                agent.questionsMeasured
                              }
                            </td>

                            <td className="px-4 py-3">
                              {agent.gaps > 0 ? (
                                <span className="font-semibold">
                                  {agent.gaps}
                                </span>
                              ) : (
                                <span className="text-slate-400">
                                  None
                                </span>
                              )}
                            </td>

                            <td className="px-3 py-3">
                              <ChevronRight className="h-4 w-4 text-slate-400" />
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* MOST MISSED QUESTIONS */}

          <section>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-slate-500" />

              <h3 className="font-semibold">
                Most Missed Questions
              </h3>
            </div>

            <p className="mt-1 text-sm text-slate-500">
              Historical reviewed misses within{" "}
              {moduleName}.
            </p>

            {analytics.missedQuestions.length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">
                No historical misses recorded.
              </p>
            ) : (
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[700px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
                      <tr>
                        <th className="px-4 py-3">
                          Question
                        </th>

                        <th className="px-4 py-3">
                          Asked
                        </th>

                        <th className="px-4 py-3">
                          Missed
                        </th>

                        <th className="px-4 py-3">
                          Miss %
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {analytics.missedQuestions.map(
                        (question) => (
                          <tr
                            key={question.questionId}
                          >
                            <td className="max-w-xl px-4 py-3">
                              <p
                                className="truncate"
                                title={
                                  question.questionText
                                }
                              >
                                {
                                  question.questionText
                                }
                              </p>
                            </td>

                            <td className="px-4 py-3">
                              {question.asked}
                            </td>

                            <td className="px-4 py-3 font-semibold">
                              {question.missed}
                            </td>

                            <td className="px-4 py-3">
                              {question.missPct}%
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* KNOWLEDGE GAP TYPES */}

          <section>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-slate-500" />

              <h3 className="font-semibold">
                Knowledge Gap Types
              </h3>
            </div>

            <p className="mt-1 text-sm text-slate-500">
              Auditor-classified gap categories recorded
              while reviewing this module.
            </p>

            {analytics.gapCategories.length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">
                No knowledge-gap categories recorded yet.
              </p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {analytics.gapCategories.map(
                  (category) => (
                    <div
                      key={category.category}
                      className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 dark:border-slate-700"
                    >
                      <span className="text-sm font-medium">
                        {category.category}
                      </span>

                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold dark:bg-slate-800">
                        {category.count}
                      </span>
                    </div>
                  )
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ModuleStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
      <p className="text-xl font-semibold">
        {value}
      </p>

      <p className="mt-1 text-xs text-slate-500">
        {label}
      </p>
    </div>
  );
}

function getAttemptTimestamp(
  attempt: ExamAttempt
) {
  return (
    attempt.reviewedAt ??
    attempt.submittedAt ??
    attempt.startedAt
  );
}