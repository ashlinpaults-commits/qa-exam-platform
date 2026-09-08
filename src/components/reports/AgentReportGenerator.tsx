"use client";

import { useState } from "react";
import type { AppUser, Exam, ExamAttempt, Question } from "@/types";
import { fetchAllUsers } from "@/lib/users";
import { fetchExams } from "@/lib/exams";
import { fetchAllQuestions } from "@/lib/questions";
import { fetchAttemptsForAgent } from "@/lib/attempts";
import {
  buildAgentPerformanceReport,
  type AgentPerformanceReportData,
} from "@/lib/agentReports";
import { AgentSelectorModal } from "./AgentSelectorModal";
import { AgentPerformanceReport } from "./AgentPerformanceReport";
import { FileBarChart, Loader2, Sparkles } from "lucide-react";

interface AgentReportGeneratorProps {
  /**
   * Preloaded datasets from AnalyticsDashboard to guarantee ZERO extra Firestore reads.
   */
  preloadedExams?: Exam[];
  preloadedAttempts?: ExamAttempt[];
  preloadedQuestions?: Question[];
  preloadedUsers?: AppUser[];
  /**
   * Optional callback when reports are generated (e.g. to display at parent screen level)
   */
  onReportsGenerated?: (reports: AgentPerformanceReportData[]) => void;
  /**
   * Optional custom button label or style
   */
  buttonLabel?: string;
  className?: string;
  variant?: "primary" | "secondary" | "card";
}

export function AgentReportGenerator({
  preloadedExams,
  preloadedAttempts,
  preloadedQuestions,
  preloadedUsers,
  onReportsGenerated,
  buttonLabel = "Generate Agent Report",
  className = "",
  variant = "primary",
}: AgentReportGeneratorProps) {
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [availableAgents, setAvailableAgents] = useState<AppUser[]>(
    preloadedUsers?.filter((u) => u.role === "agent") || []
  );
  const [generatedReports, setGeneratedReports] = useState<
    AgentPerformanceReportData[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  async function handleOpenSelector() {
    setError(null);
    if (preloadedUsers && preloadedUsers.length > 0) {
      setAvailableAgents(preloadedUsers.filter((u) => u.role === "agent"));
      setSelectorOpen(true);
      return;
    }

    try {
      setLoadingUsers(true);
      const users = await fetchAllUsers();
      setAvailableAgents(users.filter((u) => u.role === "agent"));
      setSelectorOpen(true);
    } catch (err) {
      console.error("Failed to fetch agents for report generation:", err);
      setError("Unable to load agents list. Please try again.");
    } finally {
      setLoadingUsers(false);
    }
  }

  async function handleGenerate(selectedAgentIds: string[]) {
    try {
      setGenerating(true);
      setError(null);

      // Ensure exams, questions, and attempts are available
      let exams = preloadedExams;
      if (!exams || exams.length === 0) {
        exams = await fetchExams();
      }

      let questions = preloadedQuestions;
      if (!questions || questions.length === 0) {
        questions = await fetchAllQuestions();
      }

      let allAttempts = preloadedAttempts || [];
      // If attempts weren't preloaded, fetch targeted attempts only for the selected agents
      if (allAttempts.length === 0) {
        const attemptsNested = await Promise.all(
          selectedAgentIds.map((agentId) => fetchAttemptsForAgent(agentId))
        );
        allAttempts = attemptsNested.flat();
      }

      // Filter selected agents
      const selectedAgents = availableAgents.filter((a) =>
        selectedAgentIds.includes(a.uid)
      );

      // Build individual report for each agent
      const reports = selectedAgents.map((agent) =>
        buildAgentPerformanceReport({
          agent,
          exams: exams!,
          attempts: allAttempts,
          questions: questions!,
        })
      );

      if (onReportsGenerated) {
        onReportsGenerated(reports);
        setSelectorOpen(false);
      } else {
        setGeneratedReports(reports);
        setSelectorOpen(false);
      }
    } catch (err) {
      console.error("Failed to generate agent reports:", err);
      setError(
        err instanceof Error
          ? err.message
          : "An error occurred while generating reports."
      );
    } finally {
      setGenerating(false);
    }
  }

  function handleCloseReports() {
    setGeneratedReports(null);
  }

  // If reports are currently generated, display the report view
  if (generatedReports && generatedReports.length > 0) {
    return (
      <AgentPerformanceReport
        reports={generatedReports}
        onBack={handleCloseReports}
      />
    );
  }

  // Render launcher button / card
  return (
    <>
      {variant === "card" ? (
        <button
          type="button"
          onClick={handleOpenSelector}
          disabled={loadingUsers || generating}
          className={`card p-5 text-left transition hover:shadow-card-hover ${className}`}
        >
          <div className="flex items-center justify-between mb-2">
            <FileBarChart className="h-6 w-6 text-brand-600 dark:text-brand-400" />
            <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-bold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
              ONE-CLICK
            </span>
          </div>
          <p className="font-semibold text-slate-900 dark:text-white">
            {buttonLabel}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Generate individual performance reports with scores, frequently missed questions & trends.
          </p>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleOpenSelector}
          disabled={loadingUsers || generating}
          className={`${
            variant === "primary"
              ? "btn-primary"
              : "btn-secondary"
          } inline-flex items-center gap-2 text-sm shadow-sm ${className}`}
        >
          {loadingUsers || generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileBarChart className="h-4 w-4 text-emerald-400" />
          )}
          <span>{buttonLabel}</span>
        </button>
      )}

      {/* ERROR BANNER */}
      {error && (
        <div className="mt-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* AGENT SELECTOR MODAL */}
      <AgentSelectorModal
        open={selectorOpen}
        agents={availableAgents}
        onClose={() => setSelectorOpen(false)}
        onGenerate={handleGenerate}
        loading={generating}
      />
    </>
  );
}
