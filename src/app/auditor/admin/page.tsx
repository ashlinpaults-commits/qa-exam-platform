"use client";

import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AuditorNav } from "@/components/layout/AuditorNav";
import { AdminUsersScreen } from "@/components/admin/AdminUsersScreen";

export default function AdminPage() {
  return (
    <RoleGate allow={["auditor"]}>
      <AppShell>
        <AuditorNav />
        <h1 className="mb-4 text-xl font-semibold">Users</h1>
        <AdminUsersScreen />
      </AppShell>
    </RoleGate>
  );
}
