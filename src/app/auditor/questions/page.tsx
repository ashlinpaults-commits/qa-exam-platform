"use client";

import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AuditorNav } from "@/components/layout/AuditorNav";
import { QuestionBankBrowser } from "@/components/questions/QuestionBankBrowser";

export default function QuestionsPage() {
  return (
    <RoleGate allow={["auditor"]}>
      <AppShell>
        <AuditorNav />
        <h1 className="mb-4 text-xl font-semibold">Question Bank</h1>
        <QuestionBankBrowser />
      </AppShell>
    </RoleGate>
  );
}
