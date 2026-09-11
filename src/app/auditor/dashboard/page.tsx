"use client";

import { useEffect, useState } from "react";
import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AuditorNav } from "@/components/layout/AuditorNav";
import { useAuth } from "@/context/AuthContext";
import { fetchExams } from "@/lib/exams";
import { fetchAllUsers } from "@/lib/users";
import { fetchPendingReviewAttempts } from "@/lib/attempts";
import type { Exam, AppUser, ExamAttempt } from "@/types";
import { AgentReportGenerator } from "@/components/reports/AgentReportGenerator";
import { NeedsReviewCard } from "@/components/dashboard/NeedsReviewCard";
import { QuickActionsCard } from "@/components/dashboard/QuickActionsCard";
import { QaPulseCard } from "@/components/dashboard/QaPulseCard";
import { ContinueCard } from "@/components/dashboard/ContinueCard";
import { Sparkles } from "lucide-react";

export default function AuditorDashboardPage() {
  const { profile } = useAuth();

  const [exams, setExams] = useState<Exam[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [pendingAttempts, setPendingAttempts] = useState<ExamAttempt[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    Promise.all([
      fetchExams(),
      fetchAllUsers(),
      fetchPendingReviewAttempts(),
    ])
      .then(([loadedExams, loadedUsers, loadedAttempts]) => {
        if (!isMounted) return;
        setExams(loadedExams);
        setUsers(loadedUsers);
        setPendingAttempts(loadedAttempts);
      })
      .catch((err) => {
        console.error("Failed to load auditor dashboard data:", err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Time-aware greeting
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = profile?.name ? profile.name.trim().split(" ")[0] : "Auditor";

  return (
    <RoleGate allow={["auditor"]}>
      <AppShell>
        <AuditorNav />

        <div className="space-y-6">
          {/* HEADER / GREETING */}
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl dark:text-white">
                  {greeting}, {firstName}
                </h1>
                <span className="hidden items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 text-[11px] font-semibold text-brand-700 dark:bg-brand-950/60 dark:text-brand-300 sm:inline-flex">
                  <Sparkles className="h-3 w-3" />
                  Command Center
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500 sm:text-sm dark:text-slate-400">
                Here&apos;s what&apos;s happening with your QA assessments today.
              </p>
            </div>

            {/* GENERATE AGENT REPORT CTA */}
            <div className="shrink-0">
              <AgentReportGenerator
                id="auditor-dashboard-report-btn"
                buttonLabel="Generate Agent Report"
                variant="primary"
                preloadedExams={exams}
                preloadedUsers={users}
              />
            </div>
          </div>

          {/* MAIN TWO-TIER COMMAND CENTER GRID */}
          <div className="space-y-6">
            {/* ROW 1: NEEDS REVIEW + QUICK ACTIONS */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
              <div className="lg:col-span-7 xl:col-span-8">
                <NeedsReviewCard
                  attempts={pendingAttempts}
                  exams={exams}
                  users={users}
                  loading={loading}
                />
              </div>

              <div className="lg:col-span-5 xl:col-span-4">
                <QuickActionsCard
                  onOpenReportGenerator={() => {
                    const btn = document.getElementById(
                      "auditor-dashboard-report-btn"
                    );
                    btn?.click();
                  }}
                />
              </div>
            </div>

            {/* ROW 2: QA PULSE + CONTINUE WHERE YOU LEFT OFF */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-stretch">
              <div className="lg:col-span-7 xl:col-span-8">
                <QaPulseCard exams={exams} />
              </div>

              <div className="lg:col-span-5 xl:col-span-4">
                <ContinueCard
                  attempts={pendingAttempts}
                  exams={exams}
                  users={users}
                  currentUserId={profile?.uid}
                  loading={loading}
                />
              </div>
            </div>
          </div>

          {/* CLEAN RESTRAINED FOOTER */}
          <footer className="pt-4 text-center text-[11px] text-slate-400 dark:text-slate-500">
            QA Exam Platform &bull; Clinical &amp; RCM Assessment Command Center &bull; &ldquo;Better questions. Better skills. A stronger team.&rdquo;
          </footer>
        </div>
      </AppShell>
    </RoleGate>
  );
}
