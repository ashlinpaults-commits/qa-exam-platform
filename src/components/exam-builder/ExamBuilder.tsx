"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { QuestionBankBrowser } from "@/components/questions/QuestionBankBrowser";
import { SortableQuestionItem } from "./SortableQuestionItem";
import { getQuestionsByIds } from "@/lib/questions";
import { createExam, updateExam, getExam } from "@/lib/exams";
import { useAuth } from "@/context/AuthContext";
import type { Question, Exam, ExamMode, ExamStatus } from "@/types";
import { EmptyState } from "@/components/ui/Primitives";
import { Save, Rocket } from "lucide-react";

export function ExamBuilder({ examId }: { examId?: string }) {
  const { profile } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<ExamMode>("normal");
  const [status, setStatus] = useState<ExamStatus>("draft");
  const [selected, setSelected] = useState<Question[]>([]);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!examId);
  const [error, setError] = useState("");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (!examId) return;
    (async () => {
      const exam = await getExam(examId);
      if (!exam) return;
      setName(exam.name);
      setDescription(exam.description);
      setMode(exam.mode);
      setStatus(exam.status);
      const refs = [...exam.questions].sort((a, b) => a.order - b.order);
      const qs = await getQuestionsByIds(refs.map((r) => r.questionId));
      const byId = new Map(qs.map((q) => [q.id, q]));
      setSelected(refs.map((r) => byId.get(r.questionId)).filter(Boolean) as Question[]);
      setLoaded(true);
    })();
  }, [examId]);

  function toggleSelect(q: Question) {
    setSelected((prev) => (prev.some((s) => s.id === q.id) ? prev.filter((s) => s.id !== q.id) : [...prev, q]));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setSelected((prev) => {
      const oldIndex = prev.findIndex((q) => q.id === active.id);
      const newIndex = prev.findIndex((q) => q.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  async function handleSave(publish: boolean) {
    if (!profile || !name.trim() || selected.length === 0) return;
    setSaving(true);
    // Keep answer keys out of the exam document: agents can read published
    // exams, while only auditors can read `questions`.
    const questionSnapshots = Object.fromEntries(selected.map((q) => {
      const { correctOptionIndex: _correctOptionIndex, ...safeQuestion } = q;
      return [q.id, {
        ...safeQuestion,
        expectedAnswer: "",
        stats: { timesAsked: 0, avgMarks: 0, correctPct: 0, incorrectPct: 0 },
      }];
    }));
    const payload = {
      name: name.trim(),
      description: description.trim(),
      mode,
      status: publish ? ("published" as const) : status === "published" ? status : ("draft" as const),
      questions: selected.map((q, i) => ({ questionId: q.id, order: i })),
      questionSnapshots,
      assignedAgentIds: [] as string[],
    };
    try {
      if (examId) {
        await updateExam(examId, payload);
      } else {
        const id = await createExam(payload, profile.uid);
        router.push(`/auditor/exams/${id}`);
        return;
      }
      router.push("/auditor/exams");
    } catch (err) {
      console.error("Failed to save exam", err);
      setError(err instanceof Error ? err.message : "Couldn't save exam. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <p className="text-sm text-slate-400">Loading exam...</p>;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {error && <div className="fixed right-4 top-4 z-50 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
      <div>
        <h2 className="mb-3 font-semibold">Question Bank</h2>
        <QuestionBankBrowser
          selectable
          onSelect={toggleSelect}
          selectedIds={new Set(selected.map((s) => s.id))}
        />
      </div>

      <div>
        <div className="card mb-4 space-y-3 p-4">
          <input className="input font-medium" placeholder="Exam name" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className="input" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-slate-500">Exam Mode</label>
              <select className="input" value={mode} onChange={(e) => setMode(e.target.value as ExamMode)}>
                <option value="normal">Normal — one attempt, manually scored</option>
                <option value="until_perfect">Until Perfect 10 — retake until 10/10</option>
              </select>
            </div>
          </div>
        </div>

        <h2 className="mb-3 font-semibold">
          Selected Questions ({selected.length})
        </h2>
        {selected.length === 0 ? (
          <EmptyState title="No questions selected" subtitle="Click questions on the left to add them here." />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={selected.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {selected.map((q) => (
                  <SortableQuestionItem key={q.id} question={q} onRemove={() => toggleSelect(q)} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <div className="mt-4 flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => handleSave(false)} disabled={saving}>
            <Save className="mr-1.5 h-4 w-4" /> Save draft
          </button>
          <button className="btn-primary flex-1" onClick={() => handleSave(true)} disabled={saving}>
            <Rocket className="mr-1.5 h-4 w-4" /> Publish
          </button>
        </div>
      </div>
    </div>
  );
}
