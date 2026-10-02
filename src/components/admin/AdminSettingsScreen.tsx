"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  getAppSettings,
  updateAppSettings,
  fetchAuditLogs,
  validateAppSettings,
  DEFAULT_APP_SETTINGS,
} from "@/lib/settings";
import type { AppSettings, AuditLogEntry } from "@/types";
import { Badge } from "@/components/ui/Primitives";
import {
  Settings,
  Shield,
  Save,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  History,
  Info,
  Sliders,
  Bell,
  FileSpreadsheet,
  AlertOctagon,
} from "lucide-react";

export function AdminSettingsScreen() {
  const { profile } = useAuth();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [originalSettings, setOriginalSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"config" | "audit">("config");

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const loaded = await getAppSettings();
        setSettings(loaded);
        setOriginalSettings(loaded);
      } catch (err: any) {
        console.error("Failed to load settings:", err);
        setError(err.message || "Failed to load application settings.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleLoadAuditLogs() {
    setLoadingLogs(true);
    try {
      const logs = await fetchAuditLogs(50);
      setAuditLogs(logs);
    } catch (err: any) {
      console.warn("Failed to load audit logs:", err);
    } finally {
      setLoadingLogs(false);
    }
  }

  useEffect(() => {
    if (activeTab === "audit") {
      handleLoadAuditLogs();
    }
  }, [activeTab]);

  function handleChange<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
  }

  async function handleSave(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!profile) return;

    setError("");
    setSuccessMessage("");

    // Validate inputs
    const validation = validateAppSettings(settings);
    if (!validation.valid) {
      setError(validation.errors.join(" "));
      return;
    }

    try {
      setSaving(true);
      const updated = await updateAppSettings(settings, {
        uid: profile.uid,
        email: profile.email,
        name: profile.name,
      });

      setSettings(updated);
      setOriginalSettings(updated);
      setSuccessMessage("Application settings successfully saved and applied.");
    } catch (err: any) {
      console.error("Failed to save settings:", err);
      setError(err.message || "Failed to save settings. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  const isDirty = JSON.stringify(settings) !== JSON.stringify(originalSettings);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-6">
        <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
        <span>Loading application settings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner Notifications */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 p-3.5 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            className="text-xs text-green-700 hover:underline dark:text-green-400"
            onClick={() => setSuccessMessage("")}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Settings Sub-Tab Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("config")}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "config"
              ? "bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300 font-semibold"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <Sliders className="h-4 w-4" />
          <span>Configuration</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("audit")}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            activeTab === "audit"
              ? "bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300 font-semibold"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          <History className="h-4 w-4" />
          <span>Audit Trail</span>
        </button>
      </div>

      {activeTab === "config" ? (
        <form onSubmit={handleSave} className="space-y-6">
          {/* Card 1: General Platform Information */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <Settings className="h-5 w-5 text-brand-600" />
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  General Platform Settings
                </h3>
                <p className="text-xs text-slate-500">
                  Configure brand identity and administrative contact details.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                  Application Name
                </label>
                <input
                  type="text"
                  className="input text-sm w-full"
                  value={settings.appName}
                  onChange={(e) => handleChange("appName", e.target.value)}
                  placeholder="QA Exam Platform"
                  required
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Brand name shown across the system header and login screens (2–60 chars).
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                  Support Contact Email
                </label>
                <input
                  type="email"
                  className="input text-sm w-full"
                  value={settings.supportContactEmail || ""}
                  onChange={(e) => handleChange("supportContactEmail", e.target.value)}
                  placeholder="qa-support@company.com"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Auditor/admin email address shown to agents requesting assistance or review.
                </p>
              </div>
            </div>
          </div>

          {/* Card 2: Exam & Assessment Defaults */}
          <div className="card p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <Clock className="h-5 w-5 text-indigo-600" />
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Exam & Evaluation Defaults
                </h3>
                <p className="text-xs text-slate-500">
                  Standard baseline values applied to future exam creations and reassignments.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                  Default Duration (Minutes)
                </label>
                <input
                  type="number"
                  min={1}
                  max={600}
                  className="input text-sm w-full"
                  value={settings.defaultExamDuration}
                  onChange={(e) => handleChange("defaultExamDuration", parseInt(e.target.value, 10) || 60)}
                  required
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Allowed: 1 – 600 mins (standard is 60).
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                  Passing Score (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="input text-sm w-full"
                  value={settings.defaultPassingScore}
                  onChange={(e) => handleChange("defaultPassingScore", parseInt(e.target.value, 10) || 0)}
                  required
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Allowed: 0 – 100% (standard is 70%).
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                  Default Reassignment Mode
                </label>
                <select
                  className="input text-sm w-full"
                  value={settings.defaultReassignmentMode}
                  onChange={(e) =>
                    handleChange("defaultReassignmentMode", e.target.value as "full_exam" | "incorrect_only")
                  }
                >
                  <option value="full_exam">Full Exam (All Questions)</option>
                  <option value="incorrect_only">Incorrect Questions Only</option>
                </select>
                <p className="mt-1 text-[11px] text-slate-400">
                  Default mode pre-selected in the auditor reassignment modal.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                  Agent Reattempts
                </label>
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="checkbox"
                    id="allowAgentReattempts"
                    checked={settings.allowAgentReattempts}
                    onChange={(e) => handleChange("allowAgentReattempts", e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <label htmlFor="allowAgentReattempts" className="text-xs text-slate-700 dark:text-slate-200">
                    Allow Auditor Reassignments
                  </label>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  When enabled, auditors may grant subsequent attempts to agents.
                </p>
              </div>
            </div>
          </div>

          {/* Card 3: Notifications & Reporting */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Notifications */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                <Bell className="h-5 w-5 text-amber-500" />
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Notifications
                  </h3>
                  <p className="text-xs text-slate-500">
                    Configure alert and dispatch rules.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="enableEmailNotifications"
                    checked={settings.enableEmailNotifications}
                    onChange={(e) => handleChange("enableEmailNotifications", e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <label htmlFor="enableEmailNotifications" className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    Enable System Email Alerts
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                    Notification Dispatch Email
                  </label>
                  <input
                    type="email"
                    className="input text-sm w-full"
                    value={settings.notificationEmail || ""}
                    onChange={(e) => handleChange("notificationEmail", e.target.value)}
                    placeholder="alerts@company.com"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Recipient for automated exam completion and reassignment digests.
                  </p>
                </div>
              </div>
            </div>

            {/* Reports */}
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Reports & Analytics
                  </h3>
                  <p className="text-xs text-slate-500">
                    Defaults for Report 1.0 and Report 2.0 generation.
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                    Default Date Window (Days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className="input text-sm w-full"
                    value={settings.defaultReportWindowDays}
                    onChange={(e) =>
                      handleChange("defaultReportWindowDays", parseInt(e.target.value, 10) || 30)
                    }
                    required
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Initial historical timeframe loaded in the analytics and report screens (1–365 days).
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="requireAmendmentReason"
                    checked={settings.requireAmendmentReason}
                    onChange={(e) => handleChange("requireAmendmentReason", e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <label htmlFor="requireAmendmentReason" className="text-xs font-medium text-slate-700 dark:text-slate-200">
                    Require Amendment Justification Note
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Card 4: System & Maintenance Mode */}
          <div className="card p-5 space-y-4 border-l-4 border-l-red-500">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
              <AlertOctagon className="h-5 w-5 text-red-600" />
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  System Maintenance Mode
                </h3>
                <p className="text-xs text-slate-500">
                  Temporarily disable non-auditor platform access during major upgrades or database migrations.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="maintenanceMode"
                  checked={settings.maintenanceMode}
                  onChange={(e) => handleChange("maintenanceMode", e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
                />
                <label htmlFor="maintenanceMode" className="text-xs font-bold text-red-800 dark:text-red-300">
                  Enable Maintenance Mode (Auditors Only)
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                  Maintenance Notice Message
                </label>
                <textarea
                  rows={2}
                  className="input text-sm w-full"
                  value={settings.maintenanceMessage || ""}
                  onChange={(e) => handleChange("maintenanceMessage", e.target.value)}
                  placeholder="System is undergoing scheduled maintenance. Please check back shortly."
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Message presented to agents attempting to sign in or access exams during maintenance.
                </p>
              </div>
            </div>
          </div>

          {/* Bottom Action Bar */}
          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 pt-4">
            <div className="text-xs text-slate-500">
              {settings.updatedAt ? (
                <span>
                  Last modified {new Date(settings.updatedAt).toLocaleString()}
                  {settings.updatedByName ? ` by ${settings.updatedByName}` : ""}
                </span>
              ) : (
                <span>Using factory defaults.</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setSettings(originalSettings)}
                disabled={!isDirty || saving}
              >
                Reset Changes
              </button>
              <button
                type="submit"
                className="flex items-center gap-1.5 btn-primary text-xs"
                disabled={!isDirty || saving}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Save className="h-3.5 w-3.5" />
                    <span>Save Settings</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      ) : (
        /* Audit Trail View */
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-brand-600" />
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Administration Audit Trail
                </h3>
                <p className="text-xs text-slate-500">
                  Immutable security record of administrative and configuration events.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary text-xs"
              onClick={handleLoadAuditLogs}
              disabled={loadingLogs}
            >
              {loadingLogs ? "Refreshing..." : "Refresh Logs"}
            </button>
          </div>

          {loadingLogs ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-6">
              <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
              <span>Fetching audit logs...</span>
            </div>
          ) : auditLogs.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">
              No audit logs recorded yet. Administrative events will appear here automatically.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[11px] uppercase text-slate-500 dark:bg-slate-800">
                  <tr>
                    <th className="p-2.5">Timestamp</th>
                    <th className="p-2.5">Action</th>
                    <th className="p-2.5">Actor</th>
                    <th className="p-2.5">Target</th>
                    <th className="p-2.5">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {auditLogs.map((log) => {
                    const actionColors: Record<string, "brand" | "amber" | "green" | "slate"> = {
                      SETTINGS_UPDATED: "brand",
                      USER_CREATED: "green",
                      USER_UPDATED: "amber",
                      USER_DEACTIVATED: "slate",
                      USER_REACTIVATED: "green",
                      USER_ROLE_CHANGED: "brand",
                    };

                    const badgeColor = actionColors[log.action] || "slate";

                    return (
                      <tr key={log.id || `${log.timestamp || log.createdAt || 0}-${log.action}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                        <td className="p-2.5 whitespace-nowrap text-slate-500">
                          {new Date(log.timestamp || log.createdAt || Date.now()).toLocaleString()}
                        </td>
                        <td className="p-2.5 whitespace-nowrap">
                          <Badge color={badgeColor}>{log.action.replace(/_/g, " ")}</Badge>
                        </td>
                        <td className="p-2.5 whitespace-nowrap font-medium text-slate-800 dark:text-slate-200">
                          {log.actorName || log.actorEmail}
                        </td>
                        <td className="p-2.5 whitespace-nowrap text-slate-600 dark:text-slate-400">
                          {log.targetName || log.targetId || "—"}
                        </td>
                        <td className="p-2.5 text-slate-500 font-mono text-[11px]">
                          {log.details ? (
                            <span>{JSON.stringify(log.details)}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
