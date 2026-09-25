"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchExams, duplicateExam, updateExam, deleteExam } from "@/lib/exams";
import type { Exam, ExamStatus } from "@/types";
import { Badge, EmptyState, Modal } from "@/components/ui/Primitives";
import { useAuth } from "@/context/AuthContext";
import { Copy, Trash2, Users, Plus } from "lucide-react";
import { AssignAgentsModal } from "./AssignAgentsModal";

const STATUS_COLOR: Record<ExamStatus, "slate" | "brand" | "green" | "amber" | "red"> = {
  draft: "slate",
  published: "brand",
  active: "amber",
  completed: "green",
  archived: "red",
};

export function ExamListScreen() {
  const { profile } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState<Exam | null>(null);

  async function load() {
    setLoading(true);
    setExams(await fetchExams());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDuplicate(id: string) {
    if (!profile) return;
    await duplicateExam(id, profile.uid);
    load();
  }

  async function handleArchive(id: string) {
    await updateExam(id, { status: "archived" });
    load();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this exam and its config permanently? Attempts are kept for records.")) return;
    await deleteExam(id);
    load();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Exams</h1>
        <Link href="/auditor/exams/create" className="btn-primary">
          <Plus className="mr-1.5 h-4 w-4" /> Create exam
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading...</p>
      ) : exams.length === 0 ? (
        <EmptyState title="No exams yet" subtitle="Create your first exam from the question bank." />
      ) : (
        <div className="space-y-2">
          {exams.map((exam) => (
            <div key={exam.id} className="card flex items-center justify-between gap-4 p-4">
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <Link href={`/auditor/exams/${exam.id}`} className="font-medium hover:underline">{exam.name}</Link>
                  <Badge color={STATUS_COLOR[exam.status]}>{exam.status}</Badge>
                  <Badge>{exam.mode === "until_perfect" ? "Until Perfect 10" : "Normal"}</Badge>
                </div>
                <p className="truncate text-sm text-slate-500">{exam.description}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {exam.questions.length} questions · {exam.assignedAgentIds.length} agents assigned
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button className="btn-secondary px-2 py-1" onClick={() => setAssigning(exam)} title="Assign agents">
                  <Users className="h-4 w-4" />
                </button>
                <button className="btn-secondary px-2 py-1" onClick={() => handleDuplicate(exam.id)} title="Duplicate">
                  <Copy className="h-4 w-4" />
                </button>
                <button className="btn-secondary px-2 py-1 text-red-500" onClick={() => handleDelete(exam.id)} title="Delete">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!assigning} onClose={() => setAssigning(null)} title={`Assign agents — ${assigning?.name ?? ""}`}>
        {assigning && (
          <AssignAgentsModal
            exam={assigning}
            onDone={() => {
              setAssigning(null);
              load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
