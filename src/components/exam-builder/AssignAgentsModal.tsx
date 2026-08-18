"use client";

import { useEffect, useState } from "react";
import { fetchUsersByRole } from "@/lib/users";
import { updateExam } from "@/lib/exams";
import type { Exam, AppUser } from "@/types";

export function AssignAgentsModal({ exam, onDone }: { exam: Exam; onDone: () => void }) {
  const [agents, setAgents] = useState<AppUser[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(exam.assignedAgentIds));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchUsersByRole("agent").then(setAgents);
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
    await updateExam(exam.id, {
      assignedAgentIds: Array.from(selected),
      status: exam.status === "draft" ? "published" : exam.status,
    });
    setSaving(false);
    onDone();
  }

  return (
    <div className="space-y-3">
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
