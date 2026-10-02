"use client";

import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AuditorNav } from "@/components/layout/AuditorNav";
import { AdminSettingsScreen } from "@/components/admin/AdminSettingsScreen";
import { Settings, ShieldCheck, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function AuditorSettingsPage() {
  return (
    <RoleGate allow={["auditor"]}>
      <AppShell>
        <AuditorNav />

        {/* Administration Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-400">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Administration Settings
              </h1>
              <p className="text-xs text-slate-500">
                Manage backend platform defaults, exam parameters, and maintenance modes.
              </p>
            </div>
          </div>

          <Link
            href="/auditor/admin?tab=users"
            className="btn-secondary text-xs flex items-center gap-1.5 self-start sm:self-auto"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Manage Users</span>
          </Link>
        </div>

        <AdminSettingsScreen />
      </AppShell>
    </RoleGate>
  );
}
