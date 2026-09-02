"use client";

import { useEffect, useState } from "react";
import { getSystemSettings, updateSystemSettings } from "@/lib/settings";
import { useAuth } from "@/context/AuthContext";
import type { SystemSettings } from "@/types";
import {
  Building2,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Save,
  Loader2,
  History,
  Target,
} from "lucide-react";

export function SettingsScreen() {
  const { profile } = useAuth();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [orgName, setOrgName] = useState("");
  const [defaultExamMode, setDefaultExamMode] = useState<"normal" | "until_perfect">("normal");
  const [correctAnswerThreshold, setCorrectAnswerThreshold] = useState(70);
  const [enableQuestionVersioning, setEnableQuestionVersioning] = useState(true);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const data = await getSystemSettings();
        setSettings(data);
        setOrgName(data.orgName);
        setDefaultExamMode(data.defaultExamMode);
        setCorrectAnswerThreshold(data.correctAnswerThreshold);
        setEnableQuestionVersioning(data.enableQuestionVersioning);
      } catch (err) {
        console.error("Failed to load settings:", err);
        setMessage({ type: "error", text: "Failed to load system settings." });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setMessage(null);
    setSaving(true);

    try {
      const updated = await updateSystemSettings(
        {
          orgName: orgName.trim() || "QA Exam Platform",
          defaultExamMode,
          correctAnswerThreshold: Math.min(100, Math.max(1, Number(correctAnswerThreshold) || 70)),
          enableQuestionVersioning,
        },
        profile.uid
      );
      setSettings(updated);
      setMessage({ type: "success", text: "System settings updated successfully." });
    } catch (err) {
      console.error("Failed to save settings:", err);
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to update settings.",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading system settings...
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Configure organization-wide defaults, exam rules, and competency thresholds.
        </p>
      </div>

      {message && (
        <div
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Organization Details */}
        <div className="card p-5">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 font-semibold dark:border-slate-800">
            <Building2 className="h-4 w-4 text-brand-600" />
            Organization Profile
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Organization / Platform Name</label>
              <input
                className="input"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="QA Exam Platform"
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                Displayed across headers, exported reports, and email notifications.
              </p>
            </div>
          </div>
        </div>

        {/* Exam Defaults */}
        <div className="card p-5">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 font-semibold dark:border-slate-800">
            <Sliders className="h-4 w-4 text-brand-600" />
            Exam Defaults & Rules
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Default Exam Mode</label>
              <select
                className="input"
                value={defaultExamMode}
                onChange={(e) => setDefaultExamMode(e.target.value as "normal" | "until_perfect")}
              >
                <option value="normal">Normal (Single or standard attempt flow)</option>
                <option value="until_perfect">Perfect 10 (Requires 100% score to complete)</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Pre-selected exam mode when creating a new exam in the Exam Builder.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5 text-brand-600" /> Correct-Answer % Threshold
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="input w-32"
                  value={correctAnswerThreshold}
                  onChange={(e) => setCorrectAnswerThreshold(Number(e.target.value))}
                  required
                />
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">%</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Minimum score percentage required on an individual question for it to be counted as correct in competency analytics.
              </p>
            </div>
          </div>
        </div>

        {/* Question Bank Settings */}
        <div className="card p-5">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3 font-semibold dark:border-slate-800">
            <History className="h-4 w-4 text-brand-600" />
            Question Bank Revision Tracking
          </div>
          <div className="mt-4 space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={enableQuestionVersioning}
                onChange={(e) => setEnableQuestionVersioning(e.target.checked)}
              />
              <div>
                <span className="text-sm font-medium text-slate-900 dark:text-white">
                  Enable Question Version History & Diff Tracking
                </span>
                <p className="mt-0.5 text-xs text-slate-500">
                  Automatically keeps historical snapshots of previous revisions when auditors edit existing questions in the Question Bank.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Action Button */}
        <div className="flex justify-end">
          <button type="submit" className="btn-primary flex items-center gap-2" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? "Saving Changes..." : "Save Settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
