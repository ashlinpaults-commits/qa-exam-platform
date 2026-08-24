"use client";

import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AuditorNav } from "@/components/layout/AuditorNav";
import { ExamResultsScreen } from "@/components/exam-results/ExamResultsScreen";

export default function ExamResultsPage({
  params,
}: {
  params: {
    examId: string;
  };
}) {
  return (
    <RoleGate allow={["auditor"]}>
      <AppShell>
        <AuditorNav />

        <ExamResultsScreen
          examId={params.examId}
        />
      </AppShell>
    </RoleGate>
  );
}
