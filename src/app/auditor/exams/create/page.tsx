"use client";

import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AuditorNav } from "@/components/layout/AuditorNav";
import { ExamBuilder } from "@/components/exam-builder/ExamBuilder";

export default function CreateExamPage() {
  return (
    <RoleGate allow={["auditor"]}>
      <AppShell>
        <AuditorNav />
        <h1 className="mb-4 text-xl font-semibold">Create Exam</h1>
        <ExamBuilder />
      </AppShell>
    </RoleGate>
  );
}
