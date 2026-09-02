"use client";

import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AuditorNav } from "@/components/layout/AuditorNav";
import { SettingsScreen } from "@/components/settings/SettingsScreen";

export default function AuditorSettingsPage() {
  return (
    <RoleGate allow={["auditor"]}>
      <AppShell>
        <AuditorNav />
        <SettingsScreen />
      </AppShell>
    </RoleGate>
  );
}
