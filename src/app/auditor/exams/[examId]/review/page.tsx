"use client";

import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AuditorNav } from "@/components/layout/AuditorNav";
import { ReviewScreen } from "@/components/review/ReviewScreen";

export default function ExamReviewPage() {
  return (
    <RoleGate allow={["auditor"]}>
      <AppShell>
        <AuditorNav />
        <ReviewScreen />
      </AppShell>
    </RoleGate>
  );
}
