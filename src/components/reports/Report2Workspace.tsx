"use client";

import { useState, useMemo } from "react";
import type { AppUser, Exam, ExamAttempt, Question } from "@/types";
import {
  buildReport2Dataset,
  exportReport2ToExcel,
  exportReport2ToPdf,
  type Report2Dataset,
  type Report2FilterOptions,
} from "@/lib/reportGeneratorV2";
import {
  FileSpreadsheet,
  FileDown,
  Printer,
  Search,
  Users,
  BookOpen,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  ChevronRight,
  Filter,
  Layers,
  Sparkles,
  Info,
} from "lucide-react";
import { Badge, EmptyState } from "@/components/ui/Primitives";

interface Report2WorkspaceProps {
  preloadedExams: Exam[];
  preloadedAttempts: ExamAttempt[];
  preloadedQuestions: Question[];
  preloadedUsers: AppUser[];
}

export function Report2Workspace({
  preloadedExams,
  preloadedAttempts,
  preloadedQuestions,
  preloadedUsers,
}: Report2WorkspaceProps) {
  // Filter state
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());
  const [selectedExamIds, setSelectedExamIds] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Search queries for dropdowns/modals
  const [agentSearch, setAgentSearch] = useState("");
  const [examSearch, setExamSearch] = useState("");

  // UI state
  const [activeTab, setActiveTab] = useState<
    "summary" | "exams" | "questions" | "attempts" | "overall"
  >("summary");
  const [generating, setGenerating] = useState(false);
  const [generatedDataset, setGeneratedDataset] = useState<Report2Dataset | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Eligible agents (role === 'agent')
  const eligibleAgents = useMemo(() => {
    return preloadedUsers
      .filter((u) => u.role === "agent")
      .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));
  }, [preloadedUsers]);

  // Filtered agent list
  const filteredAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    if (!q) return eligibleAgents;
    return eligibleAgents.filter(
      (a) =>
        (a.name || "").toLowerCase().includes(q) ||
        (a.email || "").toLowerCase().includes(q)
    );
  }, [eligibleAgents, agentSearch]);

  // Filtered exams list
  const filteredExams = useMemo(() => {
    const q = examSearch.trim().toLowerCase();
    if (!q) return preloadedExams;
    return preloadedExams.filter((e) =>
      (e.name || "").toLowerCase().includes(q)
    );
  }, [preloadedExams, examSearch]);

  // Agent selection handlers
  function toggleAgent(id: string) {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllAgents() {
    setSelectedAgentIds(new Set(eligibleAgents.map((a) => a.uid)));
  }

  function clearAllAgents() {
    setSelectedAgentIds(new Set());
  }

  // Exam selection handlers
  function toggleExam(id: string) {
    setSelectedExamIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllExams() {
    setSelectedExamIds(new Set(preloadedExams.map((e) => e.id)));
  }

  function clearAllExams() {
    setSelectedExamIds(new Set());
  }

  // Quick date presets
  function applyDatePreset(preset: "all" | "this_month" | "last_30_days") {
    if (preset === "all") {
      setStartDate("");
      setEndDate("");
      return;
    }
    const now = new Date();
    const endStr = now.toISOString().split("T")[0];
    if (preset === "this_month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(start.toISOString().split("T")[0]);
      setEndDate(endStr);
    } else if (preset === "last_30_days") {
      const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      setStartDate(start.toISOString().split("T")[0]);
      setEndDate(endStr);
    }
  }

  // Generate Report 2.0
  function handleGenerateReport() {
    setValidationError(null);
    setSuccessMessage(null);

    // Date range validation
    if (startDate && endDate && startDate > endDate) {
      setValidationError("Start Date cannot be after End Date.");
      return;
    }

    setGenerating(true);

    try {
      const filters: Report2FilterOptions = {
        agentIds: selectedAgentIds.size > 0 ? Array.from(selectedAgentIds) : undefined,
        examIds: selectedExamIds.size > 0 ? Array.from(selectedExamIds) : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };

      const dataset = buildReport2Dataset({
        agents: preloadedUsers,
        exams: preloadedExams,
        attempts: preloadedAttempts,
        questions: preloadedQuestions,
        filters,
      });

      // Check if dataset has data
      const totalEntries =
        dataset.agentSummaries.length +
        dataset.examPerformances.length +
        dataset.attemptHistories.length;

      if (totalEntries === 0) {
        setGeneratedDataset(null);
        setValidationError("No report data found for the selected filters.");
      } else {
        setGeneratedDataset(dataset);
        setSuccessMessage("Report 2.0 generated successfully.");
      }
    } catch (err) {
      console.error("Failed to generate Report 2.0:", err);
      setValidationError(
        err instanceof Error ? err.message : "An error occurred while generating Report 2.0."
      );
    } finally {
      setGenerating(false);
    }
  }

  // Download XLSX
  function handleDownloadXlsx() {
    if (!generatedDataset) return;
    const filename =
      generatedDataset.filtersApplied.agentCount === 1
        ? `${(generatedDataset.agentSummaries[0]?.["Agent Name"] || "Agent").replace(/\s+/g, "_")}_Performance_Report_2.0.xlsx`
        : `Team_Agent_Performance_Reports.xlsx`;
    exportReport2ToExcel(generatedDataset, filename);
  }

  // Export PDF
  function handleExportPdf() {
    if (!generatedDataset) return;
    const filename =
      generatedDataset.filtersApplied.agentCount === 1
        ? `${(generatedDataset.agentSummaries[0]?.["Agent Name"] || "Agent").replace(/\s+/g, "_")}_Performance_Report_2.0.pdf`
        : `Team_Agent_Performance_Reports.pdf`;
    exportReport2ToPdf(generatedDataset, filename);
  }

  return (
    <div className="space-y-6">
      {/* FILTER CONTROL CARD */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Filter className="h-5 w-5 text-brand-600 dark:text-brand-400" />
              Report 2.0 Filters
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select agents, exams, and an assessment date window to generate the official 5-sheet workbook.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                clearAllAgents();
                clearAllExams();
                setStartDate("");
                setEndDate("");
                setGeneratedDataset(null);
                setValidationError(null);
                setSuccessMessage(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
              Reset Filters
            </button>
          </div>
        </div>

        {/* FILTER SECTIONS GRID */}
        <div className="mt-5 grid gap-6 md:grid-cols-3">
          {/* 1. AGENTS FILTER */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-brand-600" />
                Agents ({selectedAgentIds.size === 0 ? "All" : selectedAgentIds.size} of {eligibleAgents.length})
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAllAgents}
                  className="text-[11px] text-brand-600 hover:underline dark:text-brand-400 font-medium"
                >
                  All
                </button>
                <span className="text-slate-300 dark:text-slate-700">|</span>
                <button
                  type="button"
                  onClick={clearAllAgents}
                  className="text-[11px] text-slate-400 hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search agents..."
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
                className="input h-8 pl-8 text-xs w-full"
              />
            </div>

            <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800 space-y-1 bg-slate-50/50 dark:bg-slate-900/50">
              {filteredAgents.map((agent) => {
                const isSelected = selectedAgentIds.has(agent.uid);
                return (
                  <label
                    key={agent.uid}
                    className={`flex items-center gap-2 rounded px-2 py-1 text-xs cursor-pointer transition ${
                      isSelected
                        ? "bg-brand-50 text-brand-900 font-medium dark:bg-brand-950/50 dark:text-brand-300"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleAgent(agent.uid)}
                      className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 h-3.5 w-3.5"
                    />
                    <span className="truncate">{agent.name || agent.email}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 2. EXAMS FILTER */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <BookOpen className="h-3.5 w-3.5 text-brand-600" />
                Exams ({selectedExamIds.size === 0 ? "All" : selectedExamIds.size} of {preloadedExams.length})
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAllExams}
                  className="text-[11px] text-brand-600 hover:underline dark:text-brand-400 font-medium"
                >
                  All
                </button>
                <span className="text-slate-300 dark:text-slate-700">|</span>
                <button
                  type="button"
                  onClick={clearAllExams}
                  className="text-[11px] text-slate-400 hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search exams..."
                value={examSearch}
                onChange={(e) => setExamSearch(e.target.value)}
                className="input h-8 pl-8 text-xs w-full"
              />
            </div>

            <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 p-2 dark:border-slate-800 space-y-1 bg-slate-50/50 dark:bg-slate-900/50">
              {filteredExams.map((exam) => {
                const isSelected = selectedExamIds.has(exam.id);
                return (
                  <label
                    key={exam.id}
                    className={`flex items-center gap-2 rounded px-2 py-1 text-xs cursor-pointer transition ${
                      isSelected
                        ? "bg-brand-50 text-brand-900 font-medium dark:bg-brand-950/50 dark:text-brand-300"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleExam(exam.id)}
                      className="rounded border-slate-300 text-brand-600 focus:ring-brand-500 h-3.5 w-3.5"
                    />
                    <span className="truncate">{exam.name}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* 3. DATE RANGE FILTER */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5 text-brand-600" />
                Date Range
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => applyDatePreset("this_month")}
                  className="rounded px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                >
                  This Month
                </button>
                <button
                  type="button"
                  onClick={() => applyDatePreset("last_30_days")}
                  className="rounded px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                >
                  30 Days
                </button>
                <button
                  type="button"
                  onClick={() => applyDatePreset("all")}
                  className="rounded px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                >
                  All Time
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5 font-medium">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="input h-8 text-xs w-full"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-500 mb-0.5 font-medium">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="input h-8 text-xs w-full"
                />
              </div>
            </div>

            <div className="rounded-lg bg-blue-50/70 p-2.5 text-[11px] text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-900 flex items-start gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-600" />
              <span>Attempts submitted within this window will be included in the progressive master calculations.</span>
            </div>
          </div>
        </div>

        {/* GENERATE ACTION BUTTON */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="text-xs text-slate-500">
            {selectedAgentIds.size === 0 ? "All agents" : `${selectedAgentIds.size} agents`} ·{" "}
            {selectedExamIds.size === 0 ? "All exams" : `${selectedExamIds.size} exams`} ·{" "}
            {startDate && endDate ? `${startDate} to ${endDate}` : startDate ? `From ${startDate}` : endDate ? `Up to ${endDate}` : "All historical dates"}
          </div>

          <button
            type="button"
            onClick={handleGenerateReport}
            disabled={generating}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/20 transition hover:bg-brand-700 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {generating ? "Generating Report 2.0..." : "Generate Report 2.0"}
          </button>
        </div>
      </div>

      {/* FEEDBACK NOTIFICATIONS */}
      {validationError && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{validationError}</span>
        </div>
      )}

      {successMessage && generatedDataset && (
        <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 p-4 text-xs font-medium text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
            <span>
              {successMessage} Formatted according to the official 5-sheet template ({generatedDataset.agentSummaries.length} agents, {generatedDataset.examPerformances.length} exam entries, {generatedDataset.attemptHistories.length} attempts).
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadXlsx}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-green-800"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Download XLSX
            </button>
            <button
              type="button"
              onClick={handleExportPdf}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <Printer className="h-3.5 w-3.5 text-slate-500" />
              Print / PDF
            </button>
          </div>
        </div>
      )}

      {/* GENERATED DATASET PREVIEW */}
      {generatedDataset && (
        <div className="space-y-4">
          {/* STATS SUMMARY BAR */}
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <span className="text-xs text-slate-500">Agents Included</span>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                {generatedDataset.agentSummaries.length}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <span className="text-xs text-slate-500">Exam Performance Rows</span>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                {generatedDataset.examPerformances.length}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <span className="text-xs text-slate-500">Frequently Missed Qs</span>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                {generatedDataset.frequentlyMissedQuestions.length}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <span className="text-xs text-slate-500">Attempt Records</span>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                {generatedDataset.attemptHistories.length}
              </p>
            </div>
          </div>

          {/* TABBED SHEET PREVIEW CONTAINER */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            {/* SHEET TABS */}
            <div className="flex border-b border-slate-200 bg-slate-50/70 px-4 dark:border-slate-800 dark:bg-slate-800/40 overflow-x-auto">
              {[
                { key: "summary", label: "Agent Summary (Sheet 1)", count: generatedDataset.agentSummaries.length },
                { key: "exams", label: "Exam Performance (Sheet 2)", count: generatedDataset.examPerformances.length },
                { key: "questions", label: "Frequently Missed Questions (Sheet 3)", count: generatedDataset.frequentlyMissedQuestions.length },
                { key: "attempts", label: "Attempt History (Sheet 4)", count: generatedDataset.attemptHistories.length },
                { key: "overall", label: "Overall (Sheet 5)", count: 0 },
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key as any)}
                  className={`border-b-2 px-4 py-3 text-xs font-semibold whitespace-nowrap transition ${
                    activeTab === tab.key
                      ? "border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300 bg-white dark:bg-slate-900"
                      : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400"
                  }`}
                >
                  {tab.label} {tab.count > 0 && <span className="ml-1 text-[11px] opacity-75">({tab.count})</span>}
                </button>
              ))}
            </div>

            {/* TAB CONTENT: AGENT SUMMARY */}
            {activeTab === "summary" && (
              <div className="overflow-x-auto p-4">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-100/60 dark:border-slate-800 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300">
                      <th className="p-2.5 font-semibold">Agent Name</th>
                      <th className="p-2.5 font-semibold">Email</th>
                      <th className="p-2.5 font-semibold">Overall Score</th>
                      <th className="p-2.5 font-semibold">Assigned</th>
                      <th className="p-2.5 font-semibold">Attempted</th>
                      <th className="p-2.5 font-semibold">Completed</th>
                      <th className="p-2.5 font-semibold">Completion %</th>
                      <th className="p-2.5 font-semibold">Attempts</th>
                      <th className="p-2.5 font-semibold">Avg Score</th>
                      <th className="p-2.5 font-semibold">Highest</th>
                      <th className="p-2.5 font-semibold">Lowest</th>
                      <th className="p-2.5 font-semibold">Qs Attempted</th>
                      <th className="p-2.5 font-semibold">Correct</th>
                      <th className="p-2.5 font-semibold">Earned / Possible</th>
                      <th className="p-2.5 font-semibold">Avg Time</th>
                      <th className="p-2.5 font-semibold">Strongest Topic</th>
                      <th className="p-2.5 font-semibold">Weakest Topic</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {generatedDataset.agentSummaries.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                        <td className="p-2.5 font-semibold text-slate-900 dark:text-slate-100">{row["Agent Name"]}</td>
                        <td className="p-2.5 text-slate-500">{row["Agent Email"]}</td>
                        <td className="p-2.5 font-bold text-brand-600 dark:text-brand-400">{row["Overall Score (%)"]}</td>
                        <td className="p-2.5">{row["Tests Assigned"]}</td>
                        <td className="p-2.5">{row["Tests Attempted"]}</td>
                        <td className="p-2.5">{row["Tests Completed"]}</td>
                        <td className="p-2.5">{row["Completion Rate (%)"]}</td>
                        <td className="p-2.5">{row["Total Attempts"]}</td>
                        <td className="p-2.5">{row["Average Score (%)"]}</td>
                        <td className="p-2.5 text-green-600 font-medium">{row["Highest Score (%)"]}</td>
                        <td className="p-2.5 text-amber-600 font-medium">{row["Lowest Score (%)"]}</td>
                        <td className="p-2.5">{row["Questions Attempted"]}</td>
                        <td className="p-2.5">{row["Correct Answers"]}</td>
                        <td className="p-2.5 font-medium">{row["Marks Earned"]} / {row["Possible Marks"]}</td>
                        <td className="p-2.5 text-slate-500">{row["Average Time"]}</td>
                        <td className="p-2.5 text-emerald-700 dark:text-emerald-400 max-w-xs truncate" title={row["Strongest Topic"]}>{row["Strongest Topic"]}</td>
                        <td className="p-2.5 text-amber-700 dark:text-amber-400 max-w-xs truncate" title={row["Weakest Topic"]}>{row["Weakest Topic"]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB CONTENT: EXAM PERFORMANCE */}
            {activeTab === "exams" && (
              <div className="overflow-x-auto p-4">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-100/60 dark:border-slate-800 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300">
                      <th className="p-2.5 font-semibold">Agent</th>
                      <th className="p-2.5 font-semibold">Exam Name</th>
                      <th className="p-2.5 font-semibold">Mode</th>
                      <th className="p-2.5 font-semibold">Attempts</th>
                      <th className="p-2.5 font-semibold">Master Score</th>
                      <th className="p-2.5 font-semibold">Progress %</th>
                      <th className="p-2.5 font-semibold">Gain</th>
                      <th className="p-2.5 font-semibold">Mastered</th>
                      <th className="p-2.5 font-semibold">Remaining</th>
                      <th className="p-2.5 font-semibold">Latest %</th>
                      <th className="p-2.5 font-semibold">Best %</th>
                      <th className="p-2.5 font-semibold">Avg %</th>
                      <th className="p-2.5 font-semibold">Avg Time</th>
                      <th className="p-2.5 font-semibold">Review Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {generatedDataset.examPerformances.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                        <td className="p-2.5 font-medium text-slate-900 dark:text-slate-100">{row["Agent Name"]}</td>
                        <td className="p-2.5 font-semibold text-slate-800 dark:text-slate-200">{row["Exam Name"]}</td>
                        <td className="p-2.5 text-slate-500">{row.Mode}</td>
                        <td className="p-2.5">{row["Attempts Taken"]}</td>
                        <td className="p-2.5 font-medium">{row["Master Score"]} / {row["Master Total"]}</td>
                        <td className="p-2.5 font-bold text-brand-600 dark:text-brand-400">{row["Master Progress (%)"]}</td>
                        <td className="p-2.5 text-green-600 font-semibold">{row["Latest Attempt Gain"]}</td>
                        <td className="p-2.5 text-emerald-600">{row["Questions Mastered"]}</td>
                        <td className="p-2.5 text-slate-500">{row["Questions Remaining"]}</td>
                        <td className="p-2.5">{row["Latest Attempt Score (%)"]}</td>
                        <td className="p-2.5 font-medium">{row["Best Attempt Score (%)"]}</td>
                        <td className="p-2.5">{row["Average Attempt Score (%)"]}</td>
                        <td className="p-2.5 text-slate-500">{row["Average Time"]}</td>
                        <td className="p-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              row["Review Status"] === "Reviewed"
                                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                : row["Review Status"] === "Awaiting Review"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            }`}
                          >
                            {row["Review Status"]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB CONTENT: FREQUENTLY MISSED QUESTIONS */}
            {activeTab === "questions" && (
              <div className="overflow-x-auto p-4">
                {generatedDataset.frequentlyMissedQuestions.length === 0 ? (
                  <p className="p-6 text-center text-xs text-slate-500">
                    No frequently missed questions found for the selected scope. All attempted questions were answered correctly!
                  </p>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-100/60 dark:border-slate-800 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300">
                        <th className="p-2.5 font-semibold">Agent</th>
                        <th className="p-2.5 font-semibold">Module</th>
                        <th className="p-2.5 font-semibold">Topic</th>
                        <th className="p-2.5 font-semibold w-1/3">Question (Actual Text)</th>
                        <th className="p-2.5 font-semibold">Attempted</th>
                        <th className="p-2.5 font-semibold">Incorrect</th>
                        <th className="p-2.5 font-semibold">Rate</th>
                        <th className="p-2.5 font-semibold">Latest Score</th>
                        <th className="p-2.5 font-semibold">Category</th>
                        <th className="p-2.5 font-semibold">Progression</th>
                        <th className="p-2.5 font-semibold">Mastered</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {generatedDataset.frequentlyMissedQuestions.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                          <td className="p-2.5 font-medium text-slate-900 dark:text-slate-100">{row["Agent Name"]}</td>
                          <td className="p-2.5 font-medium text-slate-800 dark:text-slate-200">{row.Module}</td>
                          <td className="p-2.5 text-slate-600 dark:text-slate-400">{row.Topic}</td>
                          <td className="p-2.5 text-slate-900 dark:text-slate-100 font-medium whitespace-normal break-words">{row.Question}</td>
                          <td className="p-2.5">{row["Times Attempted"]}</td>
                          <td className="p-2.5 text-red-600 font-semibold">{row["Times Incorrect"]}</td>
                          <td className="p-2.5 text-red-600 font-bold">{row["Incorrect Rate (%)"]}</td>
                          <td className="p-2.5 font-medium">{row["Latest Score"]}</td>
                          <td className="p-2.5 text-slate-500">{row["Knowledge Gap Category"]}</td>
                          <td className="p-2.5 text-slate-700 dark:text-slate-300 font-mono text-[11px]">{row.Progression}</td>
                          <td className="p-2.5">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                row["Eventually Mastered"] === "Yes"
                                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                  : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                              }`}
                            >
                              {row["Eventually Mastered"]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* TAB CONTENT: ATTEMPT HISTORY */}
            {activeTab === "attempts" && (
              <div className="overflow-x-auto p-4">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-100/60 dark:border-slate-800 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300">
                      <th className="p-2.5 font-semibold">Agent</th>
                      <th className="p-2.5 font-semibold">Exam Name</th>
                      <th className="p-2.5 font-semibold">Attempt</th>
                      <th className="p-2.5 font-semibold">Type</th>
                      <th className="p-2.5 font-semibold">Current Exam Score</th>
                      <th className="p-2.5 font-semibold">Master Progress</th>
                      <th className="p-2.5 font-semibold">Gain</th>
                      <th className="p-2.5 font-semibold">This Attempt Score</th>
                      <th className="p-2.5 font-semibold">Status</th>
                      <th className="p-2.5 font-semibold">Time</th>
                      <th className="p-2.5 font-semibold">Submitted At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {generatedDataset.attemptHistories.map((row, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                        <td className="p-2.5 font-medium text-slate-900 dark:text-slate-100">{row["Agent Name"]}</td>
                        <td className="p-2.5 font-semibold text-slate-800 dark:text-slate-200">{row["Exam Name"]}</td>
                        <td className="p-2.5 font-mono">#{row["Attempt Number"]}</td>
                        <td className="p-2.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              row.Type === "Original"
                                ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                                : "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300"
                            }`}
                          >
                            {row.Type}
                          </span>
                        </td>
                        <td className="p-2.5 font-bold text-brand-600 dark:text-brand-400">{row["Current Exam Score (%)"]}</td>
                        <td className="p-2.5 font-semibold text-slate-900 dark:text-slate-100">{row["Master Progress"]}</td>
                        <td className="p-2.5 font-bold text-green-600">{row["Progress Gain"]}</td>
                        <td className="p-2.5 text-slate-600 dark:text-slate-400">{row["This Attempt Score"]}</td>
                        <td className="p-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              row.Status === "reviewed"
                                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                : row.Status === "submitted"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                            }`}
                          >
                            {row.Status}
                          </span>
                        </td>
                        <td className="p-2.5 text-slate-500">{row.Time}</td>
                        <td className="p-2.5 text-slate-500">{row["Submitted At"]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB CONTENT: OVERALL */}
            {activeTab === "overall" && (
              <div className="p-8 text-center text-xs text-slate-500 space-y-2">
                <p className="font-semibold text-slate-700 dark:text-slate-300 text-sm">
                  Overall Sheet (Preserved from Template)
                </p>
                <p>
                  In accordance with the supplied template, the Overall sheet is preserved in the workbook without arbitrary invented columns.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
