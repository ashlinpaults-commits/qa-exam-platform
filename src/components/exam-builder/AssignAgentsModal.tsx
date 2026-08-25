"use client";

import { useEffect, useState } from "react";
import { fetchUsersByRole } from "@/lib/users";
import { updateExam } from "@/lib/exams";
import type { Exam, AppUser, ExamStatus } from "@/types";

export function AssignAgentsModal({
  exam,
  onDone,
}: {
  exam: Exam;
  onDone: (patch: { assignedAgentIds: string[]; status: ExamStatus }) => void;
}) {
  const [agents, setAgents] = useState<AppUser[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(exam.assignedAgentIds));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchUsersByRole("agent").then(setAgents).catch((err) => {
      console.error("Failed to load agents", err);
      setError(err instanceof Error ? err.message : "Couldn't load agents.");
    });
  }, []);

  function toggle(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(uid) ? next.delete(uid) : next.add(uid);
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    const patch = {
      assignedAgentIds: Array.from(selected),
      status: exam.status === "draft" ? ("published" as const) : exam.status,
    };
    try {
      await updateExam(exam.id, patch);
      onDone(patch);
    } catch (err) {
      console.error("Failed to assign agents", err);
      setError(err instanceof Error ? err.message : "Couldn't assign agents. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      {agents.length === 0 ? (
        <p className="text-sm text-slate-400">No agent accounts found yet.</p>
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {agents.map((a) => (
            <label key={a.uid} className="flex items-center gap-2 rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-slate-700">
              <input type="checkbox" checked={selected.has(a.uid)} onChange={() => toggle(a.uid)} />
              <div>
                <p className="text-sm font-medium">{a.name}</p>
                <p className="text-xs text-slate-500">{a.email}</p>
              </div>
            </label>
          ))}
        </div>
      )}
      <button className="btn-primary w-full" onClick={handleSave} disabled={saving}>
        {saving ? "Saving..." : `Assign to ${selected.size} agent(s)`}
      </button>
    </div>
  );
}
