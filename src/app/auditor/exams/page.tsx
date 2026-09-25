"use client";

import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AuditorNav } from "@/components/layout/AuditorNav";
import { ExamListScreen } from "@/components/exam-builder/ExamListScreen";

export default function ExamsPage() {
  return (
    <RoleGate allow={["auditor"]}>
      <AppShell>
        <AuditorNav />
        <ExamListScreen />
      </AppShell>
    </RoleGate>
  );
}
