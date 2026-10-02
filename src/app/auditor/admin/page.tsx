"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AuditorNav } from "@/components/layout/AuditorNav";
import { AdminUsersScreen } from "@/components/admin/AdminUsersScreen";
import { AdminSettingsScreen } from "@/components/admin/AdminSettingsScreen";
import { Users, Settings, ShieldCheck } from "lucide-react";

function AdminPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabParam = searchParams.get("tab");

  const [activeTab, setActiveTab] = useState<"users" | "settings">(
    tabParam === "settings" ? "settings" : "users"
  );

  useEffect(() => {
    if (tabParam === "settings" || tabParam === "users") {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  function switchTab(tab: "users" | "settings") {
    setActiveTab(tab);
    router.replace(`/auditor/admin?tab=${tab}`);
  }

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
                Administration
              </h1>
              <p className="text-xs text-slate-500">
                Manage user directories, access roles, and platform settings.
              </p>
            </div>
          </div>

          {/* Section Tabs */}
          <div className="flex items-center rounded-xl bg-slate-100 p-1 dark:bg-slate-800/80 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => switchTab("users")}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
                activeTab === "users"
                  ? "bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              <Users className="h-4 w-4" />
              <span>Users</span>
            </button>
            <button
              type="button"
              onClick={() => switchTab("settings")}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
                activeTab === "settings"
                  ? "bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-slate-100"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              <Settings className="h-4 w-4" />
              <span>Settings</span>
            </button>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === "users" ? <AdminUsersScreen /> : <AdminSettingsScreen />}
      </AppShell>
    </RoleGate>
  );
}

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-sm text-slate-400">Loading administration...</p>
        </div>
      }
    >
      <AdminPageContent />
    </Suspense>
  );
}
