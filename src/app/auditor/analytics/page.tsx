"use client";

import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AuditorNav } from "@/components/layout/AuditorNav";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";

export default function AnalyticsPage() {
  return (
    <RoleGate allow={["auditor"]}>
      <AppShell>
        <AuditorNav />
        <h1 className="mb-4 text-xl font-semibold">Analytics</h1>
        <AnalyticsDashboard />
      </AppShell>
    </RoleGate>
  );
}
