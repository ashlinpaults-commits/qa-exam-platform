"use client";

import { useState } from "react";
import type { AgentPerformanceReportData, AgentExamPerformance } from "@/lib/agentReports";
import { formatTimeTaken, exportAgentReportsToExcel } from "@/lib/agentReports";
import { exportAgentReportsToPdf } from "@/lib/agentReportPdf";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Target,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FileDown,
  Loader2,
} from "lucide-react";
import { Badge, EmptyState } from "@/components/ui/Primitives";
import { QuestionContent } from "@/components/questions/QuestionContent";

interface AgentPerformanceReportProps {
  reports: AgentPerformanceReportData[];
  onBack: () => void;
}

export function AgentPerformanceReport({
  reports,
  onBack,
}: AgentPerformanceReportProps) {
  const [activeAgentIndex, setActiveAgentIndex] = useState(0);
  const [expandedExamIds, setExpandedExamIds] = useState<Set<string>>(new Set());
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  if (reports.length === 0) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Selector
        </button>
        <EmptyState
          title="No reports generated"
          subtitle="Please select at least one agent to generate a performance report."
        />
      </div>
    );
  }

  const currentReport = reports[activeAgentIndex] || reports[0];
  const { summary, examPerformances, frequentlyMissedQuestions, competency, coaching, progression } =
    currentReport;

  function toggleExamExpand(examId: string) {
    setExpandedExamIds((prev) => {
      const next = new Set(prev);
      if (next.has(examId)) next.delete(examId);
      else next.add(examId);
      return next;
    });
  }

  function handleExportPdf() {
    try {
      setExportingPdf(true);
      const filename =
        reports.length === 1
          ? `${(currentReport.agent.name || "Agent").replace(/\s+/g, "_")}_Performance_Report.pdf`
          : `Team_Agent_Performance_Reports.pdf`;
      exportAgentReportsToPdf(reports, filename);
    } catch (err) {
      console.error("Failed to export PDF report:", err);
    } finally {
      setExportingPdf(false);
    }
  }

  function handleExportExcel() {
    try {
      setExportingExcel(true);
      const filename =
        reports.length === 1
          ? `${(currentReport.agent.name || "Agent").replace(/\s+/g, "_")}_Performance_Report.xlsx`
          : `Team_Agent_Performance_Reports.xlsx`;
      exportAgentReportsToExcel(reports, filename);
    } catch (err) {
      console.error("Failed to export Excel report:", err);
    } finally {
      setExportingExcel(false);
    }
  }

  return (
    <div className="space-y-8 pb-12">
      {/* TOP CONTROLS & HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 transition"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Agent Performance Report
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Official performance &amp; competency analytics generated on{" "}
            {new Date(currentReport.generatedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={exportingPdf}
            className="btn-primary inline-flex items-center gap-2 text-sm shadow-sm"
            title="Download professional vector PDF report"
          >
            {exportingPdf ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            <span>{exportingPdf ? "Generating PDF..." : "Export PDF"}</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            disabled={exportingExcel}
            className="btn-secondary inline-flex items-center gap-2 text-sm shadow-sm"
            title="Download Excel spreadsheet (.xlsx)"
          >
            {exportingExcel ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            )}
            <span>Export Excel (.xlsx)</span>
          </button>
        </div>
      </div>

      {/* MULTI-AGENT COMPARISON & SWITCHER */}
      {reports.length > 1 && (
        <section className="space-y-4">
          {/* Comparison summary table */}
          <div className="card overflow-hidden">
            <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-3 dark:border-slate-800 dark:bg-slate-800/40">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Selected Agents Comparison ({reports.length})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50/40 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/20">
                  <tr>
                    <th className="px-5 py-2.5">Agent</th>
                    <th className="px-5 py-2.5">Overall Score</th>
                    <th className="px-5 py-2.5">Competency</th>
                    <th className="px-5 py-2.5">Tests (Comp/Assigned)</th>
                    <th className="px-5 py-2.5">Attempts</th>
                    <th className="px-5 py-2.5">Completion Rate</th>
                    <th className="px-5 py-2.5">Trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {reports.map((r, idx) => {
                    const isCurrent = idx === activeAgentIndex;
                    return (
                      <tr
                        key={r.agent.uid}
                        onClick={() => setActiveAgentIndex(idx)}
                        className={`cursor-pointer transition hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                          isCurrent
                            ? "bg-brand-50/60 dark:bg-brand-950/30 font-medium"
                            : ""
                        }`}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200 uppercase">
                              {r.agent.name ? r.agent.name.charAt(0) : "A"}
                            </div>
                            <span>{r.agent.name || "Agent"}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          {r.summary.overallScore !== null ? (
                            <span className="font-semibold text-slate-900 dark:text-white">
                              {r.summary.overallScore}%
                            </span>
                          ) : (
                            <span className="text-slate-400">No data</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {r.summary.competencyScore !== null ? (
                            <span>{r.summary.competencyScore}%</span>
                          ) : (
                            <span className="text-slate-400">N/A</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {r.summary.testsCompleted} / {r.summary.totalTestsAssigned}
                        </td>
                        <td className="px-5 py-3">{r.summary.totalAttempts}</td>
                        <td className="px-5 py-3">{r.summary.completionRate}%</td>
                        <td className="px-5 py-3">
                          <TrendBadge trend={r.trend} velocity={r.trendVelocity} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {reports.map((r, idx) => {
              const active = idx === activeAgentIndex;
              return (
                <button
                  key={r.agent.uid}
                  type="button"
                  onClick={() => setActiveAgentIndex(idx)}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition ${
                    active
                      ? "bg-brand-600 text-white shadow-md shadow-brand-500/20"
                      : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/80 border border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${
                      active
                        ? "bg-white/20 text-white"
                        : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {r.agent.name ? r.agent.name.charAt(0).toUpperCase() : "A"}
                  </div>
                  <span>{r.agent.name || "Agent"}</span>
                  {r.summary.overallScore !== null && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        active
                          ? "bg-white/25 text-white"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                      }`}
                    >
                      {r.summary.overallScore}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ACTIVE AGENT DETAIL (INTERACTIVE ON SCREEN) */}
      <AgentDetailReport
        report={currentReport}
        expandedExamIds={expandedExamIds}
        onToggleExamExpand={toggleExamExpand}
      />
    </div>
  );
}

/* =========================================================
   AGENT DETAIL REPORT (SHARED BETWEEN SCREEN & PRINT)
   ========================================================= */

function AgentDetailReport({
  report,
  isPrint = false,
  expandedExamIds = new Set(),
  onToggleExamExpand,
}: {
  report: AgentPerformanceReportData;
  isPrint?: boolean;
  expandedExamIds?: Set<string>;
  onToggleExamExpand?: (examId: string) => void;
}) {
  const {
    summary,
    examPerformances,
    frequentlyMissedQuestions,
    competency,
    coaching,
    progression,
  } = report;

  return (
    <div className="space-y-6">
      {/* =========================================================
         SECTION 1: AGENT SUMMARY & PROMINENT HEADER
         ========================================================= */}
      <section className="card p-6 shadow-sm print-avoid-break">
        <div className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6 dark:border-slate-800">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-2xl font-bold text-white shadow-lg shadow-brand-500/20 uppercase">
              {report.agent.name ? report.agent.name.charAt(0) : "A"}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-bold text-slate-900 dark:text-white print:text-slate-900">
                  {report.agent.name || "Agent"}
                </h2>
                <Badge color="brand">Active Agent</Badge>
              </div>
              <p className="mt-0.5 text-sm text-slate-500 print:text-slate-600">
                {report.agent.email || "No email on file"}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500 print:text-slate-600">
                <span>
                  UID: <code className="text-slate-600 dark:text-slate-400 font-mono">{report.agent.uid.slice(0, 10)}...</code>
                </span>
                <span>•</span>
                <span>Enrolled: {new Date(report.agent.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Overall score card */}
          <div className="flex items-center gap-4 rounded-2xl border border-brand-100 bg-gradient-to-br from-brand-50/50 to-white p-4 dark:border-brand-900/40 dark:from-brand-950/20 dark:to-slate-900 shadow-sm print:bg-slate-50 print:border-slate-200">
            <div className="text-right">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Overall Agent Score
              </p>
              <p className="mt-0.5 text-3xl font-extrabold text-brand-600 dark:text-brand-400 print:text-brand-700">
                {summary.overallScore !== null ? `${summary.overallScore}%` : "—"}
              </p>
              <p className="text-[11px] text-slate-400 max-w-[200px] print:text-slate-500">
                {summary.overallScore !== null
                  ? `${summary.totalMarksEarned} / ${summary.totalPossibleMarks} total marks earned`
                  : "No reviewed attempts yet"}
              </p>
            </div>
            <div className="h-12 w-px bg-slate-200 dark:bg-slate-700 print:bg-slate-300" />
            <div>
              <p className="text-xs font-medium text-slate-400 print:text-slate-500">Competency</p>
              <p className="text-lg font-bold text-slate-800 dark:text-slate-100 print:text-slate-900">
                {summary.competencyScore !== null ? `${summary.competencyScore}%` : "—"}
              </p>
              <div className="mt-1">
                <TrendBadge trend={report.trend} velocity={report.trendVelocity} />
              </div>
            </div>
          </div>
        </div>

        {/* METRICS GRID */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 print:grid-cols-6">
          <MetricCard
            label="Tests Assigned"
            value={String(summary.totalTestsAssigned)}
            subtext={`${summary.testsAttempted} attempted`}
          />
          <MetricCard
            label="Tests Completed"
            value={String(summary.testsCompleted)}
            subtext={`${summary.testsPending} pending`}
          />
          <MetricCard
            label="Completion Rate"
            value={`${summary.completionRate}%`}
            highlight={summary.completionRate >= 80}
          />
          <MetricCard
            label="Total Attempts"
            value={String(summary.totalAttempts)}
            subtext={`${summary.reviewedAttemptsCount} reviewed`}
          />
          <MetricCard
            label="Average Score"
            value={summary.averageScore !== null ? `${summary.averageScore}%` : "—"}
            subtext={
              summary.highestScore !== null
                ? `High: ${summary.highestScore}%`
                : undefined
            }
          />
          <MetricCard
            label="Avg. Time Taken"
            value={formatTimeTaken(summary.averageTimeTakenSeconds)}
            subtext={
              summary.lowestScore !== null
                ? `Low: ${summary.lowestScore}%`
                : undefined
            }
          />
        </div>

        {/* QUESTIONS & MARKS SUMMARY ROW */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-4 rounded-xl bg-slate-50/70 p-3.5 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800/60 print:border-slate-200 print:bg-slate-50 text-xs">
          <div>
            <span className="text-slate-500">Questions Attempted:</span>{" "}
            <span className="font-semibold text-slate-800 dark:text-slate-200 print:text-slate-900">
              {summary.totalQuestionsAttempted}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Correct Answers:</span>{" "}
            <span className="font-semibold text-emerald-600 dark:text-emerald-400 print:text-emerald-700">
              {summary.correctAnswers}{" "}
              {summary.totalQuestionsAttempted > 0
                ? `(${Math.round((summary.correctAnswers / summary.totalQuestionsAttempted) * 100)}%)`
                : ""}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Incorrect Answers:</span>{" "}
            <span className="font-semibold text-rose-600 dark:text-rose-400 print:text-rose-700">
              {summary.incorrectAnswers}{" "}
              {summary.totalQuestionsAttempted > 0
                ? `(${Math.round((summary.incorrectAnswers / summary.totalQuestionsAttempted) * 100)}%)`
                : ""}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Total Marks:</span>{" "}
            <span className="font-semibold text-slate-800 dark:text-slate-200 print:text-slate-900">
              {summary.totalMarksEarned} / {summary.totalPossibleMarks}
            </span>
          </div>
        </div>
      </section>

      {/* =========================================================
         SECTION 2 & 3: TEST / EXAM PERFORMANCE & ATTEMPT HISTORY
         ========================================================= */}
      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800 print:px-4 print:py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900">
                Assigned Tests &amp; Exam Performance
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 print:text-slate-600">
                {isPrint
                  ? "Individual performance across all assigned exams including complete historical attempts."
                  : "Individual performance across all assigned exams. Click an exam row to view its full attempt history."}
              </p>
            </div>
            <span className="text-xs text-slate-400 print:text-slate-500">
              {examPerformances.length} total exam{examPerformances.length === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        {examPerformances.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title="No tests assigned"
              subtitle="This agent currently has no assigned examinations."
            />
          </div>
        ) : (
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[950px] print:min-w-full text-left text-sm print:text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 print:bg-slate-100 print:text-slate-700">
                <tr>
                  <th className="px-6 py-3 print:px-3 print:py-2">Exam Name</th>
                  <th className="px-4 py-3 print:px-2 print:py-2">Mode</th>
                  <th className="px-4 py-3 print:px-2 print:py-2">Status</th>
                  <th className="px-4 py-3 print:px-2 print:py-2 text-center">Attempts</th>
                  <th className="px-4 py-3 print:px-2 print:py-2 text-center">Master Score</th>
                  <th className="px-4 py-3 print:px-2 print:py-2 text-center">Progress</th>
                  <th className="px-4 py-3 print:px-2 print:py-2 text-center">Latest Gain</th>
                  <th className="px-4 py-3 print:px-2 print:py-2 text-center">Mastered</th>
                  <th className="px-4 py-3 print:px-2 print:py-2">Time</th>
                  <th className="px-4 py-3 print:px-2 print:py-2">Review</th>
                  <th className="px-4 py-3 print:px-2 print:py-2">Completion</th>
                  {!isPrint && <th className="px-4 py-3 text-center print:hidden">Progression</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 print:divide-slate-200">
                {examPerformances.map((perf) => {
                  const isExpanded = isPrint ? true : expandedExamIds.has(perf.examId);
                  return (
                    <ExamPerformanceRows
                      key={perf.examId}
                      perf={perf}
                      isExpanded={isExpanded}
                      isPrint={isPrint}
                      onToggle={onToggleExamExpand ? () => onToggleExamExpand(perf.examId) : undefined}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* =========================================================
         SECTION 5: FREQUENTLY MISSED QUESTIONS (AGENT-SPECIFIC)
         ========================================================= */}
      <section className="card overflow-hidden">
        <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800 print:px-4 print:py-3">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-rose-500" />
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900">
                Frequently Missed Questions (Agent-Specific)
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 print:text-slate-600">
                Identifies questions this specific agent repeatedly answered incorrectly across eligible reviewed attempts.
              </p>
            </div>
          </div>
        </div>

        {frequentlyMissedQuestions.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title="No repeated question-level weaknesses identified"
              subtitle="The agent has achieved passing scores (≥70%) on their attempted questions or has not completed enough assessments."
            />
          </div>
        ) : (
          <div className="overflow-x-auto print:overflow-visible">
            <table className="w-full min-w-[850px] print:min-w-full text-left text-sm print:text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 print:bg-slate-100 print:text-slate-700">
                <tr>
                  <th className="px-6 py-3 print:px-3 print:py-2">Question</th>
                  <th className="px-4 py-3 print:px-2 print:py-2">Module</th>
                  <th className="px-4 py-3 print:px-2 print:py-2">Feature</th>
                  <th className="px-4 py-3 print:px-2 print:py-2 text-center">Attempts</th>
                  <th className="px-4 py-3 print:px-2 print:py-2 text-center">Incorrect</th>
                  <th className="px-4 py-3 print:px-2 print:py-2">Rate</th>
                  <th className="px-4 py-3 print:px-2 print:py-2">Progression</th>
                  <th className="px-4 py-3 print:px-2 print:py-2">Mastery Status</th>
                  <th className="px-4 py-3 print:px-2 print:py-2">Latest Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 print:divide-slate-200">
                {frequentlyMissedQuestions.map((q, i) => (
                  <tr key={`${q.questionId}-${i}`} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 print:hover:bg-transparent">
                    <td className="px-6 py-3.5 print:px-3 print:py-2.5 max-w-md print:max-w-none">
                      {q.questionText === "Question text unavailable" ? (
                        <div>
                          <p className="text-sm font-semibold text-rose-600 dark:text-rose-400 print:text-rose-700">
                            Question text unavailable
                          </p>
                          <span className="text-[10px] font-mono text-slate-400 block mt-0.5">
                            ID: {q.questionId}
                          </span>
                        </div>
                      ) : (
                        <div>
                          <QuestionContent
                            content={q.questionText}
                            className="text-sm font-medium text-slate-900 dark:text-slate-100 print:text-slate-900 print:text-xs leading-snug"
                          />
                          <span className="text-[10px] font-mono text-slate-400 block mt-1">
                            ID: {q.questionId}
                          </span>
                        </div>
                      )}
                      {q.knowledgeGapCategory && (
                        <span className="mt-1 inline-block text-[11px] font-medium text-amber-600 dark:text-amber-400 print:text-amber-700">
                          Gap: {q.knowledgeGapCategory}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 print:px-2 print:py-2.5 whitespace-nowrap text-slate-600 dark:text-slate-300 print:text-slate-800">
                      {q.module}
                    </td>
                    <td className="px-4 py-3.5 print:px-2 print:py-2.5 whitespace-nowrap text-slate-500 text-xs">
                      {q.feature}
                    </td>
                    <td className="px-4 py-3.5 print:px-2 print:py-2.5 text-center font-medium">
                      {q.timesAttempted}
                    </td>
                    <td className="px-4 py-3.5 print:px-2 print:py-2.5 text-center font-bold text-rose-600 dark:text-rose-400 print:text-rose-700">
                      {q.timesIncorrect} / {q.timesAttempted}
                    </td>
                    <td className="px-4 py-3.5 print:px-2 print:py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 print:bg-slate-200">
                          <div
                            className="h-full rounded-full bg-rose-500"
                            style={{ width: `${q.incorrectPct}%` }}
                          />
                        </div>
                        <span className="text-xs font-semibold text-rose-600 dark:text-rose-400 print:text-rose-700">
                          {q.incorrectPct}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 print:px-2 print:py-2.5 whitespace-nowrap text-xs font-mono text-slate-600 dark:text-slate-300 print:text-slate-800">
                      {q.progressionDisplay || "—"}
                    </td>
                    <td className="px-4 py-3.5 print:px-2 print:py-2.5 whitespace-nowrap">
                      {q.eventuallyMastered ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400 print:text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="h-3 w-3" /> Resolved
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 print:text-rose-700 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded-full">
                          <AlertTriangle className="h-3 w-3" /> Unresolved
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 print:px-2 print:py-2.5 whitespace-nowrap font-medium text-slate-700 dark:text-slate-200 print:text-slate-900">
                      {q.latestScore} / {q.latestMaxMarks}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* =========================================================
         SECTION 6: KNOWLEDGE GAPS & COMPETENCY
         ========================================================= */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2 print:grid-cols-2 print-avoid-break">
        {/* Module Competencies */}
        <div className="card p-6 print:p-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900">
              Competency by Module
            </h3>
            <span className="text-xs text-slate-400 print:text-slate-500">
              {competency.moduleCompetency.length} modules measured
            </span>
          </div>

          {competency.moduleCompetency.length === 0 ? (
            <p className="mt-6 text-sm text-slate-400">No module competency data available.</p>
          ) : (
            <div className="mt-4 space-y-3.5">
              {competency.moduleCompetency.map((mod) => (
                <div key={mod.module}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-200 print:text-slate-800">
                      {mod.module}
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white print:text-slate-900">
                      {mod.score}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 print:bg-slate-200">
                    <div
                      className={`h-full rounded-full transition-all ${
                        mod.score >= 80
                          ? "bg-emerald-500"
                          : mod.score >= 60
                          ? "bg-brand-500"
                          : "bg-rose-500"
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, mod.score))}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] text-slate-400 print:text-slate-500">
                    <span>{mod.questionsMeasured} question(s)</span>
                    <span>
                      {mod.correctQuestions} passed · {mod.weakQuestions} weak
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Knowledge Gaps & Coaching Intelligence */}
        <div className="card p-6 print:p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900">
                Knowledge Gaps &amp; Coaching Priorities
              </h3>
              <Badge
                color={
                  coaching.priority === "high"
                    ? "red"
                    : coaching.priority === "medium"
                    ? "amber"
                    : "green"
                }
              >
                {coaching.priority.toUpperCase()} PRIORITY
              </Badge>
            </div>

            {/* Coaching recommendation */}
            <div className="mt-4 rounded-xl bg-slate-50 p-4 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/60 print:border-slate-200 print:bg-slate-50">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Primary Coaching Focus
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-100 print:text-slate-900">
                {coaching.primaryReason || "No critical weaknesses identified."}
              </p>
              {coaching.recommendedCoachingArea && (
                <p className="mt-1 text-xs text-brand-600 dark:text-brand-400 print:text-brand-700 font-medium">
                  Focus area: {coaching.recommendedCoachingArea}
                </p>
              )}
            </div>

            {/* Knowledge Gap Category Pills */}
            <div className="mt-4">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 print:text-slate-700">
                Top Identified Knowledge Gap Categories:
              </p>
              {competency.knowledgeGaps.length === 0 ? (
                <p className="mt-2 text-xs text-slate-400">No categorised mistakes recorded.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {competency.knowledgeGaps.map((gap) => (
                    <span
                      key={gap.category}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300 print:border-amber-300 print:bg-amber-50 print:text-amber-900"
                    >
                      <span>{gap.category}</span>
                      <span className="rounded-full bg-amber-200/70 px-1.5 py-0.2 text-[10px] dark:bg-amber-800 print:bg-amber-200">
                        {gap.count}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Strongest & Weakest Modules Callout */}
          <div className="mt-6 grid grid-cols-2 gap-3 pt-4 border-t border-slate-100 dark:border-slate-800 print:border-slate-200 text-xs">
            <div className="rounded-lg bg-emerald-50/60 p-3 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 print:border-emerald-200 print:bg-emerald-50">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Strongest Area
              </p>
              <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 print:text-slate-900">
                {competency.strongestModule ? competency.strongestModule.module : "N/A"}
              </p>
              <p className="text-emerald-600 dark:text-emerald-400 print:text-emerald-700 font-medium">
                {competency.strongestModule ? `${competency.strongestModule.score}%` : "—"}
              </p>
            </div>
            <div className="rounded-lg bg-rose-50/60 p-3 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/40 print:border-rose-200 print:bg-rose-50">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-400">
                Weakest Area
              </p>
              <p className="mt-1 text-sm font-bold text-slate-900 dark:text-slate-100 print:text-slate-900">
                {competency.weakestModule ? competency.weakestModule.module : "N/A"}
              </p>
              <p className="text-rose-600 dark:text-rose-400 print:text-rose-700 font-medium">
                {competency.weakestModule ? `${competency.weakestModule.score}%` : "—"}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================
         SECTION 7 & 8: OVERALL SCORECARD & PERFORMANCE TREND
         ========================================================= */}
      <section className="card p-6 shadow-sm print:p-4 print-avoid-break">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 print:text-slate-900">
              Performance Trend &amp; Official Scorecard
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 print:text-slate-600">
              Historical progression across chronological reviewed attempts.
            </p>
          </div>
          <div className="text-xs text-slate-500 print:text-slate-600">
            Calculation: <span className="font-medium text-slate-700 dark:text-slate-300 print:text-slate-900">Total Marks Earned ÷ Total Possible Marks × 100</span>
          </div>
        </div>

        {/* Timeline Progression */}
        <div className="mt-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 print:text-slate-500 mb-3">
            Attempt Timeline Progression
          </p>
          {progression.length === 0 ? (
            <p className="text-sm text-slate-400">No reviewed attempts recorded yet.</p>
          ) : (
            <div className={`flex items-center gap-2 pb-2 ${isPrint ? "flex-wrap" : "overflow-x-auto"}`}>
              {progression.map((pt, idx) => {
                const isLast = idx === progression.length - 1;
                return (
                  <div key={pt.attemptId} className="flex items-center shrink-0">
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-center dark:border-slate-700 dark:bg-slate-800/60 print:border-slate-200 print:bg-slate-50 min-w-[110px]">
                      <p className="text-[11px] text-slate-400 print:text-slate-500 truncate max-w-[100px]" title={pt.examName}>
                        {pt.examName}
                      </p>
                      <p className="mt-1 text-base font-extrabold text-slate-900 dark:text-white print:text-slate-900">
                        {pt.scorePct}%
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        Att. #{pt.attemptNumber} · {pt.formattedDate}
                      </p>
                    </div>
                    {!isLast && (
                      <ArrowRight className="mx-2 h-4 w-4 text-slate-300 dark:text-slate-600 print:text-slate-400 shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Official Calculation Disclosure Note */}
        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/60 p-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/30 print:border-slate-200 print:bg-slate-50">
          <p className="font-semibold text-slate-700 dark:text-slate-300 print:text-slate-800">
            About the Overall Score &amp; Analytics Eligibility
          </p>
          <p className="mt-1">
            Overall score is based on eligible reviewed attempts ({summary.totalMarksEarned} marks earned of {summary.totalPossibleMarks} possible marks).
            Incomplete and pending attempts are strictly excluded from score metrics until officially finalized by an auditor.
            Archived exams are preserved for historical auditability and clearly labeled.
          </p>
        </div>
      </section>
    </div>
  );
}

/* =========================================================
   EXAM PERFORMANCE ROW & EXPANDABLE ATTEMPT HISTORY (SECTION 2 & 3)
   ========================================================= */

function ExamPerformanceRows({
  perf,
  isExpanded,
  isPrint = false,
  onToggle,
}: {
  perf: AgentExamPerformance;
  isExpanded: boolean;
  isPrint?: boolean;
  onToggle?: () => void;
}) {
  const showHistory = isPrint ? perf.attempts.length > 0 : isExpanded;

  return (
    <>
      <tr
        onClick={onToggle}
        className={`${onToggle ? "cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/40" : ""} transition print:hover:bg-transparent`}
      >
        <td className="px-6 py-4 print:px-3 print:py-2.5">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900 dark:text-white print:text-slate-900">
              {perf.examName}
            </span>
            {perf.isArchived && <Badge color="red">Archived</Badge>}
          </div>
          {perf.category && (
            <p className="mt-0.5 text-xs text-slate-400 print:text-slate-500">{perf.category}</p>
          )}
        </td>
        <td className="px-4 py-4 print:px-2 print:py-2.5 whitespace-nowrap text-xs text-slate-500">
          {perf.mode === "until_perfect" ? "Perfect 10" : "Normal"}
        </td>
        <td className="px-4 py-4 print:px-2 print:py-2.5 whitespace-nowrap">
          <span
            className={`inline-block h-2 w-2 rounded-full mr-1.5 ${
              perf.status === "archived"
                ? "bg-slate-400"
                : perf.status === "published" || perf.status === "active"
                ? "bg-emerald-500"
                : "bg-amber-500"
            }`}
          />
          <span className="capitalize text-xs text-slate-600 dark:text-slate-300 print:text-slate-800">
            {perf.status}
          </span>
        </td>
        <td className="px-4 py-4 print:px-2 print:py-2.5 whitespace-nowrap text-center font-medium text-slate-800 dark:text-slate-200 print:text-slate-900">
          {perf.attemptsTaken}
        </td>
        <td className="px-4 py-4 print:px-2 print:py-2.5 whitespace-nowrap text-center font-bold text-slate-900 dark:text-white print:text-slate-900">
          {perf.masterScore !== null ? `${perf.masterScore} / ${perf.masterTotalMarks}` : "—"}
        </td>
        <td className="px-4 py-4 print:px-2 print:py-2.5 whitespace-nowrap text-center font-bold text-brand-600 dark:text-brand-400 print:text-brand-700">
          {perf.masterPercentage !== null ? `${perf.masterPercentage}%` : "—"}
        </td>
        <td className="px-4 py-4 print:px-2 print:py-2.5 whitespace-nowrap text-center text-xs font-semibold">
          {perf.latestAttemptGain !== null ? (
            <span
              className={`rounded-full px-2 py-0.5 ${
                perf.latestAttemptGain > 0
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 print:bg-emerald-50 print:text-emerald-800"
                  : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
              }`}
            >
              {perf.latestAttemptGain > 0 ? `+${perf.latestAttemptGain}` : `${perf.latestAttemptGain}`}
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </td>
        <td className="px-4 py-4 print:px-2 print:py-2.5 whitespace-nowrap text-center text-xs font-medium text-slate-700 dark:text-slate-300 print:text-slate-800">
          {perf.questionsMastered} / {perf.questionsMastered + perf.questionsRemaining}
        </td>
        <td className="px-4 py-4 print:px-2 print:py-2.5 whitespace-nowrap text-xs text-slate-500">
          {formatTimeTaken(perf.timeTakenSeconds)}
        </td>
        <td className="px-4 py-4 print:px-2 print:py-2.5 whitespace-nowrap">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              perf.reviewStatus === "Reviewed"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 print:bg-emerald-50 print:text-emerald-800"
                : perf.reviewStatus === "Awaiting Review"
                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 print:bg-amber-50 print:text-amber-800"
                : perf.reviewStatus === "In Progress"
                ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 print:bg-blue-50 print:text-blue-800"
                : "bg-slate-100 text-slate-500 dark:bg-slate-800 print:bg-slate-100 print:text-slate-600"
            }`}
          >
            {perf.reviewStatus}
          </span>
        </td>
        <td className="px-4 py-4 print:px-2 print:py-2.5 whitespace-nowrap">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
              perf.completionStatus === "Completed"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 print:bg-emerald-50 print:text-emerald-800"
                : perf.completionStatus === "Pending"
                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 print:bg-amber-50 print:text-amber-800"
                : "bg-slate-100 text-slate-500 dark:bg-slate-800 print:bg-slate-100 print:text-slate-600"
            }`}
          >
            {perf.completionStatus}
          </span>
        </td>
        {!isPrint && (
          <td className="px-4 py-4 text-center print:hidden">
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
              title={isExpanded ? "Collapse Progression" : "Expand Attempt Progression"}
            >
              {isExpanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </td>
        )}
      </tr>

      {/* ATTEMPT PROGRESSION (SECTION 3) */}
      {showHistory && (
        <tr className="bg-slate-50/70 dark:bg-slate-900/50 print:bg-slate-50 print-avoid-break">
          <td colSpan={isPrint ? 11 : 12} className="px-8 py-4 print:px-4 print:py-3 border-y border-slate-200 dark:border-slate-800 print:border-slate-200">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 print:text-slate-700">
                  Attempt Progression for &ldquo;{perf.examName}&rdquo; ({perf.attempts.length} attempt{perf.attempts.length === 1 ? "" : "s"})
                </p>
                <div className="flex items-center gap-3 text-xs font-medium">
                  <span className="text-brand-600 dark:text-brand-400 print:text-brand-700">
                    Master Score: {perf.masterScore ?? "—"} / {perf.masterTotalMarks} ({perf.masterPercentage !== null ? `${perf.masterPercentage}%` : "—"})
                  </span>
                  <span className="text-slate-400">•</span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {perf.questionsMastered} / {perf.questionsMastered + perf.questionsRemaining} Mastered
                  </span>
                </div>
              </div>

              {perf.attempts.length === 0 ? (
                <p className="text-xs text-slate-400">No attempts have been recorded for this test.</p>
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
                  {perf.attempts.map((att) => (
                    <div
                      key={att.id}
                      className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-800/80 print:border-slate-200 print:bg-white"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-slate-900 dark:text-white print:text-slate-900 text-sm">
                            Attempt #{att.attemptNumber}
                          </span>
                          {att.isReattempt ? (
                            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 print:bg-indigo-50 print:text-indigo-800">
                              Retake
                            </span>
                          ) : att.attemptNumber === 1 ? (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300 print:bg-slate-100 print:text-slate-700">
                              Original
                            </span>
                          ) : null}
                          {att.isArchivedExam && (
                            <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 print:bg-rose-50 print:text-rose-800">
                              Archived
                            </span>
                          )}
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                            att.status === "reviewed"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 print:bg-emerald-100 print:text-emerald-800"
                              : att.status === "submitted" || att.status === "review_in_progress"
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 print:bg-amber-100 print:text-amber-800"
                              : "bg-slate-100 text-slate-600 dark:bg-slate-700 print:bg-slate-100 print:text-slate-700"
                          }`}
                        >
                          {att.status.replace(/_/g, " ")}
                        </span>
                      </div>

                      <div className="mt-3 space-y-2 border-t border-slate-100 dark:border-slate-800/80 pt-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Current Exam Score:</span>
                          <span className="text-sm font-bold text-slate-800 dark:text-slate-200 print:text-slate-900">
                            {att.score !== null ? `${att.score}%` : "—"}{" "}
                            <span className="text-xs font-normal text-slate-400">
                              ({att.totalMarks ?? "—"} / {att.maxTotalMarks ?? "—"})
                            </span>
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-500">Master Progress:</span>
                          <span className="text-sm font-bold text-brand-600 dark:text-brand-400 print:text-brand-700">
                            {att.cumulativeMasterScore !== null
                              ? `${att.cumulativeMasterScore} / ${perf.masterTotalMarks}`
                              : "—"}{" "}
                            <span className="text-xs font-normal text-slate-400">
                              ({att.cumulativePercentage !== null ? `${att.cumulativePercentage}%` : "—"})
                            </span>
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-500">Progress Gain:</span>
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                            {att.progressGain !== null && att.progressGain !== undefined
                              ? att.progressGain > 0
                                ? `+${att.progressGain} pts`
                                : `${att.progressGain} pts`
                              : "—"}
                          </span>
                        </div>
                        {att.isReattempt && att.rawAttemptMarks !== null && att.rawAttemptMarks !== undefined && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-slate-500">This Attempt:</span>
                            <span className="font-medium text-slate-700 dark:text-slate-300 print:text-slate-800">
                              {att.rawAttemptMarks} / {att.rawAttemptMaxMarks}{" "}
                              <span className="text-slate-400">({att.rawAttemptScore ?? "—"}%)</span>
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-dashed border-slate-100 dark:border-slate-800">
                          <span>Time: {formatTimeTaken(att.timeTakenSeconds)}</span>
                          {att.submittedAt && (
                            <span className="text-[11px] text-slate-400 print:text-slate-500">
                              {new Date(att.submittedAt).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* =========================================================
   SMALL REUSABLE PRESENTATION PIECES
   ========================================================= */

function MetricCard({
  label,
  value,
  subtext,
  highlight = false,
}: {
  label: string;
  value: string;
  subtext?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3.5 transition ${
        highlight
          ? "border-brand-200 bg-brand-50/40 dark:border-brand-900/40 dark:bg-brand-950/20"
          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-800/60"
      }`}
    >
      <p className="text-xs font-medium text-slate-400 truncate">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{value}</p>
      {subtext && <p className="mt-0.5 text-[11px] text-slate-500 truncate">{subtext}</p>}
    </div>
  );
}

function TrendBadge({
  trend,
  velocity,
}: {
  trend: string;
  velocity: number | null;
}) {
  if (trend === "improving") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
        <ArrowUp className="h-3.5 w-3.5" /> Improving {velocity !== null ? `(+${velocity}%)` : ""}
      </span>
    );
  }
  if (trend === "declining") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 dark:text-rose-400">
        <ArrowDown className="h-3.5 w-3.5" /> Declining {velocity !== null ? `(${velocity}%)` : ""}
      </span>
    );
  }
  if (trend === "stable") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
        <ArrowRight className="h-3.5 w-3.5" /> Stable
      </span>
    );
  }
  return <span className="text-xs text-slate-400">Need 2+ reviews</span>;
}
