"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronRight,
  ClipboardList,
  Clock3,
  Target,
  UserCheck,
  Users,
  X,
} from "lucide-react";

import { fetchExams } from "@/lib/exams";
import { fetchAttemptsForExam } from "@/lib/attempts";
import { fetchAllQuestions } from "@/lib/questions";
import { fetchAllUsers } from "@/lib/users";

import {
  calculateAllAgentCompetencies,
  calculateAllCoachingAssessments,
  type AgentCompetency,
  type AgentCoachingAssessment,
  type CoachingPriority,
  type LearningTrend,
} from "@/lib/competency";

import type {
  AppUser,
  Exam,
  ExamAttempt,
  Question,
} from "@/types";

import { EmptyState } from "@/components/ui/Primitives";
import { MetricInfo } from "@/components/ui/MetricInfo";

/*
 * Session-scoped cache for this dashboard's combined dataset. Lives outside
 * the component so it survives unmount/remount (navigating away and back)
 * but not a full page reload — that's fine, a reload is a natural,
 * infrequent point to pay for a fresh read. This does not touch
 * fetchExams/fetchAttemptsForExam/fetchAllUsers themselves, so no other
 * screen's freshness guarantees change.
 */
let analyticsDataCache: {
  exams: Exam[];
  attempts: ExamAttempt[];
  questions: Question[];
  users: AppUser[];
  fetchedAt: number;
} | null = null;

const ANALYTICS_CACHE_TTL_MS = 2 * 60 * 1000;

export function AnalyticsDashboard() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedAgent, setSelectedAgent] =
    useState<AgentCompetency | null>(null);
    const [selectedModule, setSelectedModule] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);

        /*
         * This dashboard needs full attempt history to compute agent
         * competency/coaching trends, so its Firestore reads scale with
         * total attempts (unavoidable without a bigger precomputed-
         * aggregate rework — see Phase 5 notes). What we CAN cheaply
         * avoid is re-running that full scan every time someone opens
         * this page in the same session. A short in-memory cache
         * collapses repeated visits into one read.
         */
        const cached = analyticsDataCache;
        if (
          cached &&
          Date.now() - cached.fetchedAt <
            ANALYTICS_CACHE_TTL_MS
        ) {
          setExams(cached.exams);
          setAttempts(cached.attempts);
          setQuestions(cached.questions);
          setUsers(cached.users);
          setLoading(false);
          return;
        }

        const examList = await fetchExams();

        const allAttempts = (
          await Promise.all(
            examList.map((exam) =>
              fetchAttemptsForExam(exam.id)
            )
          )
        ).flat();

        // Shares the same cache as the Question Bank browser, and has no
        // hard cap — the old fetchQuestionsPage({}, 3000) call would
        // silently truncate once the bank passed 3,000 questions.
        const questionList =
          await fetchAllQuestions();

        const allUsers = await fetchAllUsers();

        analyticsDataCache = {
          exams: examList,
          attempts: allAttempts,
          questions: questionList,
          users: allUsers,
          fetchedAt: Date.now(),
        };

        setExams(examList);
        setAttempts(allAttempts);
        setQuestions(questionList);
        setUsers(allUsers);
      } catch (error) {
        console.error("Unable to load analytics:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const competencies = useMemo(
    () =>
      calculateAllAgentCompetencies({
        attempts,
        questions,
        users,
      }),
    [attempts, questions, users]
  );
  const coachingAssessments = useMemo(
  () => calculateAllCoachingAssessments(competencies),
  [competencies]
);

const coachingCounts = useMemo(
  () => ({
    high: coachingAssessments.filter(
      (item) => item.priority === "high"
    ).length,

    medium: coachingAssessments.filter(
      (item) => item.priority === "medium"
    ).length,

    healthy: coachingAssessments.filter(
      (item) => item.priority === "healthy"
    ).length,
  }),
  [coachingAssessments]
);

  const questionMap = useMemo(
    () =>
      new Map(
        questions.map((question) => [
          question.id,
          question,
        ])
      ),
    [questions]
  );

  const examMap = useMemo(
    () =>
      new Map(
        exams.map((exam) => [exam.id, exam])
      ),
    [exams]
  );

  if (loading) {
    return (
      <p className="text-sm text-slate-400">
        Loading analytics...
      </p>
    );
  }

  /* =========================================================
     TOP OPERATIONAL STATS
     ========================================================= */

  const totalExams = exams.length;

  const totalAssignments = exams.reduce(
    (sum, exam) => sum + exam.assignedAgentIds.length,
    0
  );

  /*
   * An assignment is considered completed once the agent
   * has at least submitted an attempt for that exam.
   *
   * In-progress attempts remain pending.
   */
  const pendingAssignments = exams.reduce(
    (sum, exam) => {
      const pendingForExam =
        exam.assignedAgentIds.filter((agentId) => {
          const agentAttempts = attempts.filter(
            (attempt) =>
              attempt.examId === exam.id &&
              attempt.agentId === agentId
          );

          return !agentAttempts.some(
            (attempt) =>
              attempt.status === "submitted" ||
              attempt.status === "review_in_progress" ||
              attempt.status === "reviewed"
          );
        }).length;

      return sum + pendingForExam;
    },
    0
  );

  const agentsAssessed = new Set(
    attempts
      .filter((attempt) => attempt.status === "reviewed")
      .map((attempt) => attempt.agentId)
  ).size;

  /* =========================================================
     CURRENT TEAM MODULE PERFORMANCE

     Latest reviewed answer per agent + question.
     ========================================================= */

  const latestTeamAnswers = new Map<
    string,
    {
      marks: number;
      maxMarks: number;
      questionId: string;
      timestamp: number;
    }
  >();

  const reviewedChronological = [...attempts]
    .filter((attempt) => attempt.status === "reviewed")
    .sort(
      (a, b) =>
        getAttemptTimestamp(a) - getAttemptTimestamp(b)
    );

  reviewedChronological.forEach((attempt) => {
    attempt.answers.forEach((answer) => {
      if (answer.marks === undefined) return;

      const key = `${attempt.agentId}::${answer.questionId}`;

      latestTeamAnswers.set(key, {
        marks: answer.marks,
        maxMarks: answer.maxMarks,
        questionId: answer.questionId,
        timestamp: getAttemptTimestamp(attempt),
      });
    });
  });

  const moduleMap = new Map<
    string,
    {
      marks: number;
      maxMarks: number;
      questions: number;
    }
  >();

  latestTeamAnswers.forEach((answer) => {
    const question = questionMap.get(answer.questionId);
    if (!question) return;

    const current = moduleMap.get(question.module) ?? {
      marks: 0,
      maxMarks: 0,
      questions: 0,
    };

    current.marks += answer.marks;
    current.maxMarks += answer.maxMarks;
    current.questions += 1;

    moduleMap.set(question.module, current);
  });

  const modulePerformance = Array.from(moduleMap.entries())
    .map(([module, value]) => ({
      module,
      score:
        value.maxMarks > 0
          ? Math.round(
              (value.marks / value.maxMarks) * 100
            )
          : 0,
      questions: value.questions,
    }))
    .sort((a, b) => b.score - a.score);

  /* =========================================================
     FREQUENTLY MISSED QUESTIONS

     Every finalized review already increments the question's own
     stats.timesAsked/correctPct/incorrectPct atomically (see
     finalizeReview in lib/attempts.ts). Reusing that precomputed,
     incrementally-maintained aggregate here means this report no longer
     needs to rescan every historical attempt — it's derived entirely
     from the `questions` list already loaded above, so this metric's
     cost doesn't grow with attempt/response history at all.

     A miss = below 70%, matching the same threshold finalizeReview uses
     to maintain correctPct/incorrectPct, so this is not a behavior
     change from the old attempt-scanning version.
     ========================================================= */

  const frequentlyMissed = questions
    .map((question) => {
      const asked =
        question.stats?.timesAsked ?? 0;

      const incorrectPct =
        question.stats?.incorrectPct ?? 0;

      const missed = Math.round(
        (incorrectPct / 100) * asked
      );

      return {
        questionId: question.id,
        questionText: question.questionText,
        module: question.module,
        asked,
        missed,
        missPct: Math.round(incorrectPct),
      };
    })
    .filter(
      (item) => item.asked > 0 && item.missed > 0
    )
    .sort((a, b) => {
      if (b.missed !== a.missed) {
        return b.missed - a.missed;
      }

      return b.missPct - a.missPct;
    })
    .slice(0, 10);

  return (
    <>
      <div className="space-y-7">
        {/* HEADER */}

        <div>
          <h1 className="text-2xl font-semibold">
            Analytics
          </h1>

          <p className="mt-1 text-sm text-slate-500">
            Agent competency, assessment activity and
            knowledge gaps.
          </p>
        </div>

        {/* OPERATIONAL SUMMARY */}

        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          <SummaryCard
            icon={<ClipboardList className="h-4 w-4" />}
            value={totalExams}
            label="Total Exams"
          />

          <SummaryCard
            icon={<Users className="h-4 w-4" />}
            value={totalAssignments}
            label="Agent Assignments"
          />

          <SummaryCard
            icon={<Clock3 className="h-4 w-4" />}
            value={pendingAssignments}
            label="Pending Completion"
            info={
              <MetricInfo
                title="Pending Completion"
                description="Agent-exam assignments where the agent has not yet submitted an attempt."
              />
            }
          />

          <SummaryCard
            icon={<UserCheck className="h-4 w-4" />}
            value={agentsAssessed}
            label="Agents Assessed"
          />
        </div>

        {/* AGENT COMPETENCY */}

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
            <h2 className="font-semibold">
              Agent Competency
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Click an agent to inspect their assessment
              history.
            </p>
          </div>

          {competencies.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No agent data yet"
                subtitle="Agent competency appears after assessments begin."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-5 py-3">Agent</th>

                    <th className="px-5 py-3">
                      <HeaderWithInfo
                        label="Competency"
                        info="Uses the latest reviewed answer for each unique question to represent what the agent currently knows."
                      />
                    </th>

                    <th className="px-5 py-3">
                      Exams
                    </th>

                    <th className="px-5 py-3">
                      Attempts
                    </th>

                    <th className="px-5 py-3">
                      <HeaderWithInfo
                        label="Trend"
                        info="Difference between the agent's first and latest reviewed attempt performance."
                      />
                    </th>

                    <th className="px-5 py-3">
                      Weakest Module
                    </th>

                    <th className="px-5 py-3">
                      <HeaderWithInfo
                        label="Persistent Gaps"
                        info="Questions scored below 70% by the same agent in at least two reviewed attempts."
                      />
                    </th>

                    <th className="w-10 px-3 py-3" />
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {competencies.map((competency) => {
                    const agentExamIds = new Set(
                      attempts
                        .filter(
                          (attempt) =>
                            attempt.agentId ===
                            competency.agentId
                        )
                        .map((attempt) => attempt.examId)
                    );

                    return (
                      <tr
                        key={competency.agentId}
                        onClick={() =>
                          setSelectedAgent(competency)
                        }
                        className="cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <td className="px-5 py-4">
                          <div>
                            <p className="font-medium text-slate-900 dark:text-white">
                              {competency.agent?.name ??
                                competency.agentId.slice(
                                  0,
                                  10
                                )}
                            </p>

                            {competency.agent?.email && (
                              <p className="mt-0.5 text-xs text-slate-400">
                                {competency.agent.email}
                              </p>
                            )}
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <CompetencyCell
                            score={
                              competency.competencyScore
                            }
                          />
                        </td>

                        <td className="px-5 py-4 font-medium">
                          {agentExamIds.size}
                        </td>

                        <td className="px-5 py-4">
                          <p className="font-medium">
                            {competency.totalAttempts}
                          </p>

                          <p className="text-xs text-slate-400">
                            {
                              competency.reviewedAttempts
                            }{" "}
                            reviewed
                          </p>
                        </td>

                        <td className="px-5 py-4">
                          <TrendDisplay
                            trend={
                              competency.learningTrend
                            }
                            velocity={
                              competency.learningVelocity
                            }
                          />
                        </td>

                        <td className="px-5 py-4">
                          {competency.weakestModule ? (
                            <>
                              <p className="font-medium">
                                {
                                  competency.weakestModule
                                    .module
                                }
                              </p>

                              <p className="text-xs text-slate-400">
                                {
                                  competency.weakestModule
                                    .score
                                }
                                %
                              </p>
                            </>
                          ) : (
                            <span className="text-slate-400">
                              -
                            </span>
                          )}
                        </td>

                        <td className="px-5 py-4">
                          {competency.persistentGaps
                            .length > 0 ? (
                            <span className="font-semibold">
                              {
                                competency.persistentGaps
                                  .length
                              }
                            </span>
                          ) : (
                            <span className="text-slate-400">
                              None
                            </span>
                          )}
                        </td>

                        <td className="px-3 py-4">
                          <ChevronRight className="h-4 w-4 text-slate-400" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {/* COACHING PRIORITY */}

<section className="card overflow-hidden">
  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
    <div>
      <div className="flex items-center gap-2">
        <Target className="h-4 w-4 text-slate-500" />

        <h2 className="font-semibold">
          Coaching Priority
        </h2>

        <MetricInfo
          title="Coaching Priority"
          description="Agents are prioritized using current competency, persistent knowledge gaps, weak modules, learning trend and repeated attempts. Repeated attempts alone do not create a high priority."
        />
      </div>

      <p className="mt-1 text-sm text-slate-500">
        Agents who may require QA coaching or knowledge
        reinforcement.
      </p>
    </div>

    <div className="flex flex-wrap gap-2">
      <PriorityCount
        label="High"
        count={coachingCounts.high}
        priority="high"
      />

      <PriorityCount
        label="Medium"
        count={coachingCounts.medium}
        priority="medium"
      />

      <PriorityCount
        label="Healthy"
        count={coachingCounts.healthy}
        priority="healthy"
      />
    </div>
  </div>

  {coachingAssessments.length === 0 ? (
    <div className="p-5">
      <EmptyState
        title="No coaching data yet"
        subtitle="Coaching priority appears after reviewed assessments are available."
      />
    </div>
  ) : (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {coachingAssessments.map((assessment) => (
        <CoachingRow
          key={assessment.agentId}
          assessment={assessment}
          competency={competencies.find(
            (item) =>
              item.agentId === assessment.agentId
          )}
          onOpenAgent={(competency) =>
            setSelectedAgent(competency)
          }
        />
      ))}
    </div>
  )}
</section>

        {/* MODULE PERFORMANCE */}

        <section className="card p-5">
          <div className="mb-5">
            <h2 className="font-semibold">
              Module Performance
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Current team competency by module.
            </p>
          </div>

          {modulePerformance.length === 0 ? (
            <p className="text-sm text-slate-400">
              No reviewed module data yet.
            </p>
          ) : (
            <div className="space-y-4">
              {modulePerformance.map((module) => (
                <div key={module.module}>
                  <div className="mb-1.5 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">
                        {module.module}
                      </p>

                      <p className="text-xs text-slate-400">
                        {module.questions} measured answers
                      </p>
                    </div>

                    <p className="text-sm font-semibold">
                      {module.score}%
                    </p>
                  </div>

                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(0, module.score)
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* FREQUENTLY MISSED */}

        <section className="card overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-700">
            <h2 className="font-semibold">
              Frequently Missed Questions
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              Questions producing the highest number of
              reviewed misses.
            </p>
          </div>

          {frequentlyMissed.length === 0 ? (
            <p className="p-5 text-sm text-slate-400">
              No missed questions yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[750px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
                  <tr>
                    <th className="px-5 py-3">
                      Question
                    </th>
                    <th className="px-5 py-3">
                      Module
                    </th>
                    <th className="px-5 py-3">
                      Asked
                    </th>
                    <th className="px-5 py-3">
                      Missed
                    </th>
                    <th className="px-5 py-3">
                      Miss %
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {frequentlyMissed.map((item) => (
                    <tr key={item.questionId}>
                      <td className="max-w-xl px-5 py-3">
                        <p
                          className="truncate"
                          title={item.questionText}
                        >
                          {item.questionText}
                        </p>
                      </td>

                      <td className="px-5 py-3">
                        {item.module}
                      </td>

                      <td className="px-5 py-3">
                        {item.asked}
                      </td>

                      <td className="px-5 py-3 font-semibold">
                        {item.missed}
                      </td>

                      <td className="px-5 py-3">
                        {item.missPct}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* AGENT HISTORY MODAL */}

      {selectedAgent && (
        <AgentHistoryModal
          competency={selectedAgent}
          attempts={attempts}
          examMap={examMap}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </>
  );
}

/* =========================================================
   AGENT HISTORY MODAL
   ========================================================= */

function AgentHistoryModal({
  competency,
  attempts,
  examMap,
  onClose,
}: {
  competency: AgentCompetency;
  attempts: ExamAttempt[];
  examMap: Map<string, Exam>;
  onClose: () => void;
}) {
  const agentAttempts = attempts
    .filter(
      (attempt) =>
        attempt.agentId === competency.agentId
    )
    .sort(
      (a, b) =>
        getAttemptTimestamp(b) - getAttemptTimestamp(a)
    );

  const examGroups = new Map<string, ExamAttempt[]>();

  agentAttempts.forEach((attempt) => {
    const existing = examGroups.get(attempt.examId) ?? [];
    existing.push(attempt);
    examGroups.set(attempt.examId, existing);
  });

  const completedExamCount = Array.from(
    examGroups.values()
  ).filter((group) =>
    group.some((attempt) => attempt.status === "reviewed")
  ).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
      >
        {/* MODAL HEADER */}

        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-6 py-5 dark:border-slate-700 dark:bg-slate-900">
          <div>
            <h2 className="text-xl font-semibold">
              {competency.agent?.name ??
                competency.agentId}
            </h2>

            {competency.agent?.email && (
              <p className="mt-1 text-sm text-slate-500">
                {competency.agent.email}
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-6">
          {/* QUICK SUMMARY */}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat
              label="Competency"
              value={
                competency.competencyScore !== null
                  ? `${competency.competencyScore}%`
                  : "-"
              }
            />

            <MiniStat
              label="Exams Completed"
              value={String(completedExamCount)}
            />

            <MiniStat
              label="Total Attempts"
              value={String(competency.totalAttempts)}
            />

            <MiniStat
              label="Persistent Gaps"
              value={String(
                competency.persistentGaps.length
              )}
            />
          </div>

          {/* CURRENT KNOWLEDGE */}

          <div>
            <h3 className="font-semibold">
              Current Knowledge
            </h3>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <DetailCard
                label="Strongest Module"
                value={
                  competency.strongestModule
                    ? `${competency.strongestModule.module} · ${competency.strongestModule.score}%`
                    : "Not enough data"
                }
              />

              <DetailCard
                label="Weakest Module"
                value={
                  competency.weakestModule
                    ? `${competency.weakestModule.module} · ${competency.weakestModule.score}%`
                    : "Not enough data"
                }
              />

              <DetailCard
                label="Learning Trend"
                value={formatTrend(
                  competency.learningTrend,
                  competency.learningVelocity
                )}
              />

              <DetailCard
                label="Questions Measured"
                value={String(
                  competency.questionsMeasured
                )}
              />
            </div>
          </div>

          {/* EXAM HISTORY */}

          <div>
            <h3 className="font-semibold">
              Exam History
            </h3>

            <p className="mt-1 text-sm text-slate-500">
              Attempts are retained so progression remains
              auditable.
            </p>

            <div className="mt-4 space-y-3">
              {Array.from(examGroups.entries()).map(
                ([examId, group]) => {
                  const exam = examMap.get(examId);

                  const ordered = [...group].sort(
                    (a, b) =>
                      a.attemptNumber - b.attemptNumber
                  );

                  return (
                    <div
                      key={examId}
                      className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">
                            {exam?.name ??
                              "Unknown Exam"}
                          </p>

                          <p className="mt-1 text-xs text-slate-400">
                            {exam?.mode ===
                            "until_perfect"
                              ? "Until Perfect"
                              : "Normal"}{" "}
                            · {ordered.length} attempt
                            {ordered.length === 1
                              ? ""
                              : "s"}
                          </p>
                        </div>

                        <AttemptProgression
                          attempts={ordered}
                        />
                      </div>

                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full min-w-[560px] text-left text-sm">
                          <thead className="text-xs uppercase text-slate-400">
                            <tr>
                              <th className="pb-2">
                                Attempt
                              </th>
                              <th className="pb-2">
                                Score
                              </th>
                              <th className="pb-2">
                                Status
                              </th>
                              <th className="pb-2">
                                Reviewed
                              </th>
                            </tr>
                          </thead>

                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {ordered.map((attempt) => (
                              <tr key={attempt.id}>
                                <td className="py-2">
                                  #{attempt.attemptNumber}
                                </td>

                                <td className="py-2 font-medium">
                                  {getAttemptScore(
                                    attempt
                                  )}
                                </td>

                                <td className="py-2">
                                  {formatAttemptStatus(
                                    attempt.status
                                  )}
                                </td>

                                <td className="py-2 text-slate-500">
                                  {attempt.reviewedAt
                                    ? formatDate(
                                        attempt.reviewedAt
                                      )
                                    : "-"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                }
              )}

              {examGroups.size === 0 && (
                <p className="text-sm text-slate-400">
                  No exam history available.
                </p>
              )}
            </div>
          </div>

          {/* PERSISTENT GAPS */}

          {competency.persistentGaps.length > 0 && (
            <div>
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-slate-500" />

                <h3 className="font-semibold">
                  Persistent Knowledge Gaps
                </h3>
              </div>

              <div className="mt-3 space-y-2">
                {competency.persistentGaps.map(
                  (gap) => (
                    <div
                      key={gap.questionId}
                      className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                    >
                      <p className="text-sm font-medium">
                        {gap.questionText}
                      </p>

                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>
                          Module: {gap.module}
                        </span>

                        <span>
                          Missed{" "}
                          {gap.timesBelowThreshold}{" "}
                          times
                        </span>

                        <span>
                          Latest:{" "}
                          {gap.latestScorePct}%
                        </span>
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   SMALL COMPONENTS
   ========================================================= */

function SummaryCard({
  icon,
  value,
  label,
  info,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  info?: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}

        <div className="flex items-center gap-1">
          <p className="text-xs font-medium">
            {label}
          </p>

          {info}
        </div>
      </div>

      <p className="mt-3 text-2xl font-semibold">
        {value}
      </p>
    </div>
  );
}

function HeaderWithInfo({
  label,
  info,
}: {
  label: string;
  info: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <span>{label}</span>

      <MetricInfo
        title={label}
        description={info}
      />
    </div>
  );
}

function CompetencyCell({
  score,
}: {
  score: number | null;
}) {
  if (score === null) {
    return (
      <span className="text-slate-400">
        Not measured
      </span>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className="min-w-[42px] font-semibold">
        {score}%
      </span>

      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className="h-full rounded-full bg-indigo-500"
          style={{
            width: `${Math.min(
              100,
              Math.max(0, score)
            )}%`,
          }}
        />
      </div>
    </div>
  );
}

function TrendDisplay({
  trend,
  velocity,
}: {
  trend: LearningTrend;
  velocity: number | null;
}) {
  if (trend === "insufficient_data") {
    return (
      <span className="text-xs text-slate-400">
        Need 2+ reviews
      </span>
    );
  }

  if (trend === "improving") {
    return (
      <div className="flex items-center gap-1">
        <ArrowUp className="h-4 w-4 text-emerald-500" />
        <span className="font-medium">
          +{velocity ?? 0}%
        </span>
      </div>
    );
  }

  if (trend === "declining") {
    return (
      <div className="flex items-center gap-1">
        <ArrowDown className="h-4 w-4 text-red-500" />
        <span className="font-medium">
          {velocity ?? 0}%
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <ArrowRight className="h-4 w-4 text-slate-400" />

      <span className="font-medium">
        {velocity !== null && velocity > 0 ? "+" : ""}
        {velocity ?? 0}%
      </span>
    </div>
  );
}

function MiniStat({
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

function DetailCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <p className="text-xs text-slate-400">
        {label}
      </p>

      <p className="mt-1 text-sm font-medium">
        {value}
      </p>
    </div>
  );
}

function AttemptProgression({
  attempts,
}: {
  attempts: ExamAttempt[];
}) {
  return (
    <div className="flex items-center gap-1.5">
      {attempts.map((attempt) => {
        const perfect =
          attempt.status === "reviewed" &&
          attempt.totalMarks !== undefined &&
          attempt.maxTotalMarks !== undefined &&
          attempt.maxTotalMarks > 0 &&
          attempt.totalMarks === attempt.maxTotalMarks;

        if (perfect) {
          return (
            <span
              key={attempt.id}
              title={`Attempt ${attempt.attemptNumber}: Perfect`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50"
            >
              <Check className="h-3.5 w-3.5" />
            </span>
          );
        }

        if (attempt.status === "reviewed") {
          return (
            <span
              key={attempt.id}
              title={`Attempt ${attempt.attemptNumber}: Reviewed`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-500 dark:bg-red-950/40"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          );
        }

        return (
          <span
            key={attempt.id}
            title={`Attempt ${attempt.attemptNumber}: ${formatAttemptStatus(
              attempt.status
            )}`}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500 dark:bg-slate-800"
          >
            {attempt.attemptNumber}
          </span>
        );
      })}
    </div>
  );
}
/* =========================================================
   COACHING COMPONENTS
   ========================================================= */

function CoachingRow({
  assessment,
  competency,
  onOpenAgent,
}: {
  assessment: AgentCoachingAssessment;
  competency?: AgentCompetency;
  onOpenAgent: (competency: AgentCompetency) => void;
}) {
  const canOpen = Boolean(competency);

  return (
    <button
      type="button"
      disabled={!canOpen}
      onClick={() => {
        if (competency) {
          onOpenAgent(competency);
        }
      }}
      className="grid w-full grid-cols-1 gap-4 px-5 py-4 text-left transition hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-slate-800/40 sm:grid-cols-[180px_110px_1fr_150px_30px] sm:items-center"
    >
      {/* AGENT */}

      <div className="min-w-0">
        <p className="truncate font-medium text-slate-900 dark:text-white">
          {assessment.agent?.name ??
            assessment.agentId.slice(0, 10)}
        </p>

        {assessment.agent?.email && (
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {assessment.agent.email}
          </p>
        )}
      </div>

      {/* PRIORITY */}

      <div>
        <PriorityBadge priority={assessment.priority} />
      </div>

      {/* REASON */}

      <div className="min-w-0">
        <p className="text-sm font-medium">
          {assessment.primaryReason}
        </p>

        <p className="mt-1 text-xs text-slate-500">
          {buildCoachingSummary(assessment)}
        </p>
      </div>

      {/* COMPETENCY */}

      <div className="sm:text-right">
        <p className="text-sm font-semibold">
          {assessment.competencyScore !== null
            ? `${assessment.competencyScore}%`
            : "Not measured"}
        </p>

        <p className="mt-0.5 text-xs text-slate-400">
          competency
        </p>
      </div>

      {/* OPEN */}

      <div className="hidden justify-end sm:flex">
        {canOpen && (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
      </div>
    </button>
  );
}

function PriorityBadge({
  priority,
}: {
  priority: CoachingPriority;
}) {
  const config: Record<
    CoachingPriority,
    {
      label: string;
      className: string;
    }
  > = {
    high: {
      label: "High",
      className:
        "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
    },

    medium: {
      label: "Medium",
      className:
        "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
    },

    healthy: {
      label: "Healthy",
      className:
        "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
    },

    insufficient_data: {
      label: "Insufficient",
      className:
        "bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
    },
  };

  const current = config[priority];

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${current.className}`}
    >
      {current.label}
    </span>
  );
}

function PriorityCount({
  label,
  count,
  priority,
}: {
  label: string;
  count: number;
  priority: CoachingPriority;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 dark:border-slate-700">
      <PriorityDot priority={priority} />

      <span className="text-xs text-slate-500">
        {label}
      </span>

      <span className="text-xs font-semibold">
        {count}
      </span>
    </div>
  );
}

function PriorityDot({
  priority,
}: {
  priority: CoachingPriority;
}) {
  let className = "bg-slate-400";

  if (priority === "high") {
    className = "bg-red-500";
  }

  if (priority === "medium") {
    className = "bg-amber-500";
  }

  if (priority === "healthy") {
    className = "bg-emerald-500";
  }

  return (
    <span
      className={`h-2 w-2 rounded-full ${className}`}
    />
  );
}

function buildCoachingSummary(
  assessment: AgentCoachingAssessment
) {
  const parts: string[] = [];

  if (assessment.persistentGapCount > 0) {
    parts.push(
      `${assessment.persistentGapCount} persistent ${
        assessment.persistentGapCount === 1
          ? "gap"
          : "gaps"
      }`
    );
  }

  if (assessment.weakestModule) {
    parts.push(
      `${assessment.weakestModule.module} ${assessment.weakestModule.score}%`
    );
  }

  if (
    assessment.learningTrend === "improving" &&
    assessment.learningVelocity !== null
  ) {
    parts.push(
      `improving +${assessment.learningVelocity}%`
    );
  }

  if (
    assessment.learningTrend === "declining" &&
    assessment.learningVelocity !== null
  ) {
    parts.push(
      `declining ${Math.abs(
        assessment.learningVelocity
      )}%`
    );
  }

  if (parts.length === 0) {
    if (
      assessment.priority === "insufficient_data"
    ) {
      return "More reviewed assessment data required.";
    }

    return "No significant coaching risks detected.";
  }

  return parts.join(" · ");
}


/* =========================================================
   HELPERS
   ========================================================= */

function getAttemptTimestamp(attempt: ExamAttempt) {
  return (
    attempt.reviewedAt ??
    attempt.submittedAt ??
    attempt.startedAt
  );
}

function getAttemptScore(attempt: ExamAttempt) {
  if (
    attempt.totalMarks === undefined ||
    !attempt.maxTotalMarks
  ) {
    return "-";
  }

  return `${Math.round(
    (attempt.totalMarks / attempt.maxTotalMarks) * 100
  )}%`;
}

function formatAttemptStatus(
  status: ExamAttempt["status"]
) {
  switch (status) {
    case "in_progress":
      return "In Progress";

    case "submitted":
      return "Awaiting Review";

    case "review_in_progress":
      return "Review In Progress";

    case "reviewed":
      return "Reviewed";
  }
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
}

function formatTrend(
  trend: LearningTrend,
  velocity: number | null
) {
  if (trend === "insufficient_data") {
    return "Need at least 2 reviewed attempts";
  }

  if (trend === "improving") {
    return `Improving · +${velocity ?? 0}%`;
  }

  if (trend === "declining") {
    return `Declining · ${velocity ?? 0}%`;
  }

  return `Stable · ${
    velocity !== null && velocity > 0 ? "+" : ""
  }${velocity ?? 0}%`;
}