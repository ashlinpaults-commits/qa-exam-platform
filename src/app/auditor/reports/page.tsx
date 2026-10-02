"use client";

import { useEffect, useState } from "react";
import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AuditorNav } from "@/components/layout/AuditorNav";
import { fetchExams } from "@/lib/exams";
import { fetchAttemptsForExam } from "@/lib/attempts";
import { fetchAllQuestions } from "@/lib/questions";
import { fetchAllUsers } from "@/lib/users";
import type { AppUser, Exam, ExamAttempt, Question } from "@/types";
import { AgentReportGenerator } from "@/components/reports/AgentReportGenerator";
import { AgentPerformanceReport } from "@/components/reports/AgentPerformanceReport";
import { Report2Workspace } from "@/components/reports/Report2Workspace";
import type { AgentPerformanceReportData } from "@/lib/agentReports";
import { FileText, FileSpreadsheet, Sparkles, Layers } from "lucide-react";

export default function ReportsWorkspacePage() {
  const [reportVersion, setReportVersion] = useState<"v1" | "v2">("v2");

  const [exams, setExams] = useState<Exam[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Report 1.0 generated reports view state
  const [activeReport1Data, setActiveReport1Data] = useState<AgentPerformanceReportData[] | null>(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [loadedExams, loadedQuestions, loadedUsers] = await Promise.all([
          fetchExams(),
          fetchAllQuestions(),
          fetchAllUsers(),
        ]);

        const allAttempts = (
          await Promise.all(
            loadedExams.map((e) => fetchAttemptsForExam(e.id))
          )
        ).flat();

        setExams(loadedExams);
        setQuestions(loadedQuestions);
        setUsers(loadedUsers);
        setAttempts(allAttempts);
      } catch (err) {
        console.error("Failed to load reports workspace data:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  return (
    <RoleGate allow={["auditor"]}>
      <AppShell>
        <AuditorNav />

        <div className="space-y-6">
          {/* HEADER & VERSION SWITCHER */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5 dark:border-slate-800">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 flex items-center gap-2.5">
                <FileSpreadsheet className="h-6 w-6 text-brand-600 dark:text-brand-400" />
                Reports Workspace
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Official QA assessment reporting, multi-sheet Excel workbooks, and printable audit summaries.
              </p>
            </div>

            {/* VERSION SELECTOR */}
            <div className="flex items-center rounded-xl bg-slate-100 p-1 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setReportVersion("v2")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                  reportVersion === "v2"
                    ? "bg-white text-brand-700 shadow-sm dark:bg-slate-900 dark:text-brand-300"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
                Report 2.0 (Template Engine)
              </button>

              <button
                type="button"
                onClick={() => setReportVersion("v1")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition ${
                  reportVersion === "v1"
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-900 dark:text-slate-100"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                <FileText className="h-3.5 w-3.5 text-slate-500" />
                Existing Report (Report 1.0)
              </button>
            </div>
          </div>

          {loading ? (
            <div className="flex min-h-[300px] items-center justify-center rounded-2xl border border-slate-200 bg-white p-12 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600 dark:border-brand-900 dark:border-t-brand-400" />
                <p className="mt-3 text-sm text-slate-500 font-medium">Loading reporting workspace data...</p>
              </div>
            </div>
          ) : reportVersion === "v2" ? (
            /* REPORT 2.0 WORKSPACE */
            <Report2Workspace
              preloadedExams={exams}
              preloadedAttempts={attempts}
              preloadedQuestions={questions}
              preloadedUsers={users}
            />
          ) : (
            /* EXISTING REPORT 1.0 WORKSPACE (100% PRESERVED) */
            <div className="space-y-6">
              {activeReport1Data && activeReport1Data.length > 0 ? (
                <AgentPerformanceReport
                  reports={activeReport1Data}
                  onBack={() => setActiveReport1Data(null)}
                />
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900 shadow-sm space-y-4">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <FileText className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      Existing Report (Report 1.0)
                    </h3>
                    <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
                      Generate individual or team performance reports using the original Report 1.0 viewer, with full interactive tabs and original PDF/XLSX export.
                    </p>
                  </div>

                  <div className="pt-2">
                    <AgentReportGenerator
                      preloadedExams={exams}
                      preloadedAttempts={attempts}
                      preloadedQuestions={questions}
                      preloadedUsers={users}
                      onReportsGenerated={(reports) => setActiveReport1Data(reports)}
                      buttonLabel="Select Agents & Generate Report 1.0"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </AppShell>
    </RoleGate>
  );
}
