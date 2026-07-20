"use client";

import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AgentDashboardContent } from "@/components/agent/AgentDashboardContent";

export default function AgentDashboardPage() {
  return (
    <RoleGate allow={["agent"]}>
      <AppShell>
        <AgentDashboardContent />
      </AppShell>
    </RoleGate>
  );
}
