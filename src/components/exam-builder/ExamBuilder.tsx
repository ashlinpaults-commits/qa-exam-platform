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
import { ExamQuestionImportModal } from "./ExamQuestionImportModal";
import { getQuestionsByIds, createRedactedQuestionSnapshot, stripUndefined } from "@/lib/questions";
import {
  createExam,
  updateExam,
  getExam,
  fetchExams,
  formatStandardExamName,
  getNextExamNumber,
  getKnownBatches,
  parseExamNameComponents,
} from "@/lib/exams";
import {
  CONTROLLED_MODULES,
  ControlledModule,
  normalizeLegacyModule,
} from "@/config/taxonomy";
import { useAuth } from "@/context/AuthContext";
import type { Question, Exam, ExamMode, ExamStatus } from "@/types";
import { EmptyState } from "@/components/ui/Primitives";
import { Save, Rocket, Loader2, CheckCircle2, Users, Upload, Sparkles, Layers } from "lucide-react";

const ASSESSMENT_TYPES = ["Test", "Quiz", "Evaluation", "Midterm", "Final"] as const;

export function ExamBuilder({ examId }: { examId?: string }) {
  const { profile } = useAuth();
  const router = useRouter();

  // Standardized Taxonomy States
  const [batch, setBatch] = useState("PS1126");
  const [customBatch, setCustomBatch] = useState(false);
  const [module, setModule] = useState<ControlledModule>("RCM & Clinical");
  const [assessmentType, setAssessmentType] = useState<string>("Test");
  const [testNumber, setTestNumber] = useState(1);
  const [manualNameOverride, setManualNameOverride] = useState(false);
  const [name, setName] = useState("");
  const [allExams, setAllExams] = useState<Exam[]>([]);

  const [category, setCategory] = useState<"Revenue Cycle Management" | "Patient Engagement">("Revenue Cycle Management");
  const [examDate, setExamDate] = useState(new Date().toISOString().split("T")[0]);
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<ExamMode>("normal");
  const [status, setStatus] = useState<ExamStatus>("draft");
  const [assignedAgentIds, setAssignedAgentIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<Question[]>([]);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(!examId);
  const [error, setError] = useState("");
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [examImportOpen, setExamImportOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Load existing exams to determine known batches and next numbering
  useEffect(() => {
    fetchExams().then((exams) => {
      setAllExams(exams);
    }).catch(console.error);
  }, []);

  // Dynamically update auto-generated exam name when Batch, Module, or Assessment Type changes
  useEffect(() => {
    if (examId || manualNameOverride) return;
    const nextNum = getNextExamNumber(allExams, batch, module, assessmentType);
    setTestNumber(nextNum);
    setName(formatStandardExamName(batch, module, assessmentType, nextNum));
  }, [batch, module, assessmentType, allExams, examId, manualNameOverride]);

  useEffect(() => {
    if (!examId) return;
    (async () => {
      try {
        const exam = await getExam(examId);
        if (!exam) {
          setError("Exam not found.");
          setLoaded(true);
          return;
        }
        setName(exam.name);
        setDescription(exam.description);
        setMode(exam.mode);
        setStatus(exam.status);
        setAssignedAgentIds(exam.assignedAgentIds ?? []);

        // Parse legacy or standardized exam name components
        const parsed = parseExamNameComponents(exam.name);
        if (parsed.batch) setBatch(parsed.batch);
        if (parsed.module) setModule(parsed.module);
        if (parsed.assessmentType) setAssessmentType(parsed.assessmentType);
        if (parsed.testNumber) setTestNumber(parsed.testNumber);

        // Load or infer category
        if (exam.category) {
          setCategory(exam.category);
        } else {
          setCategory(
            parsed.module === "Patient Engagement"
              ? "Patient Engagement"
              : "Revenue Cycle Management"
          );
        }

        // Load or format exam date
        if (exam.examDate) {
          setExamDate(exam.examDate);
        } else if (exam.createdAt) {
          setExamDate(new Date(exam.createdAt).toISOString().split("T")[0]);
        }

        const refs = [...exam.questions].sort((a, b) => a.order - b.order);
        const qs = await getQuestionsByIds(refs.map((r) => r.questionId));
        const byId = new Map(qs.map((q) => [q.id, q]));

        // Fall back to historical snapshot if a question was archived or missing in bank
        const resolved = refs
          .map((r) => byId.get(r.questionId) || exam.questionSnapshots?.[r.questionId])
          .filter(Boolean) as Question[];

        setSelected(resolved);
      } catch (err) {
        console.error("Failed to load exam", err);
        setError("Failed to load exam data. Please retry.");
      } finally {
        setLoaded(true);
      }
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

  function handleExamQuestionsImported(newQuestions: Question[]) {
    setSelected((prev) => {
      const existingIds = new Set(prev.map((q) => q.id));
      const toAdd = newQuestions.filter((q) => !existingIds.has(q.id));
      return [...prev, ...toAdd];
    });
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 3500);
  }

  async function handleSave(publish: boolean) {
    if (!profile || !name.trim() || selected.length === 0) {
      if (!name.trim()) setError("Please provide an exam name.");
      else if (selected.length === 0) setError("Please select at least one question.");
      return;
    }

    setSaving(true);
    setError("");

    // Ensure unique questions in stable contiguous order
    const seenIds = new Set<string>();
    const uniqueSelected: Question[] = [];
    for (const q of selected) {
      if (q && q.id && !seenIds.has(q.id)) {
        seenIds.add(q.id);
        uniqueSelected.push(q);
      }
    }

    // Keep answer keys out of the exam document: agents can read published
    // exams, while only auditors can read `questions`.
    const questionSnapshots = Object.fromEntries(
      uniqueSelected.map((q) => [q.id, createRedactedQuestionSnapshot(q)])
    );

    // Target status logic:
    // If auditor explicitly clicked publish -> "published"
    // If editing existing exam -> retain current status (e.g. "published", "active", "draft", etc.)
    // If creating a new exam -> "draft"
    const cleanBatch = batch.trim().replace(/\s+/g, "").toUpperCase();
    const cleanCategory: "Revenue Cycle Management" | "Patient Engagement" =
      module === "Patient Engagement" ? "Patient Engagement" : "Revenue Cycle Management";

    const targetStatus: ExamStatus = publish ? "published" : examId ? status : "draft";

    const payload = stripUndefined({
      name: name.trim(),
      batch: cleanBatch,
      batchId: cleanBatch,
      module,
      assessmentType,
      testNumber,
      category: cleanCategory,
      examDate: examDate || undefined,
      description: description.trim(),
      mode,
      status: targetStatus,
      questions: uniqueSelected.map((q, i) => ({ questionId: q.id, order: i })),
      questionSnapshots,
      assignedAgentIds: examId ? assignedAgentIds : ([] as string[]),
    });

    try {
      if (examId) {
        await updateExam(examId, payload);
        setStatus(targetStatus);
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 3000);
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

  const knownBatches = getKnownBatches(allExams);

  if (!loaded) return <p className="text-sm text-slate-400">Loading exam...</p>;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {/* Toast notifications */}
      {error && (
        <div className="fixed right-4 top-4 z-50 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 shadow-md">
          {error}
        </div>
      )}
      {savedSuccess && (
        <div className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-md">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          Exam saved successfully.
        </div>
      )}

      {/* Left Column: Question Bank Picker */}
      <div>
        <h2 className="mb-3 font-semibold">Question Bank</h2>
        <QuestionBankBrowser
          selectable
          onSelect={toggleSelect}
          selectedIds={new Set(selected.map((s) => s.id))}
        />
      </div>

      {/* Right Column: Exam Details & Selected Questions */}
      <div>
        <div className="card mb-4 space-y-3 p-4">
          {/* Standardized Exam Classification */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-900/40">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Standardized Exam Identification
              </span>
              <button
                type="button"
                onClick={() => setManualNameOverride((prev) => !prev)}
                className="text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                {manualNameOverride ? "Use Standard Auto-Name" : "Custom Title Override"}
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {/* Batch Selector */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-[11px] font-medium text-slate-500">Batch</label>
                  <button
                    type="button"
                    onClick={() => setCustomBatch((prev) => !prev)}
                    className="text-[10px] text-brand-600 hover:underline dark:text-brand-400"
                  >
                    {customBatch ? "Select existing" : "+ New"}
                  </button>
                </div>
                {customBatch ? (
                  <input
                    className="input text-xs font-semibold"
                    placeholder="e.g. PS1126"
                    value={batch}
                    onChange={(e) => setBatch(e.target.value.toUpperCase())}
                    required
                  />
                ) : (
                  <select
                    className="input text-xs font-semibold"
                    value={batch}
                    onChange={(e) => setBatch(e.target.value)}
                  >
                    {knownBatches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Module Selector */}
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-500">Module</label>
                <select
                  className="input text-xs font-semibold"
                  value={module}
                  onChange={(e) => {
                    const newMod = e.target.value as ControlledModule;
                    setModule(newMod);
                    setCategory(
                      newMod === "Patient Engagement"
                        ? "Patient Engagement"
                        : "Revenue Cycle Management"
                    );
                  }}
                >
                  {CONTROLLED_MODULES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              {/* Assessment Type Selector */}
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-500">Assessment</label>
                <select
                  className="input text-xs font-semibold"
                  value={assessmentType}
                  onChange={(e) => setAssessmentType(e.target.value)}
                >
                  {ASSESSMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Generated Standard Name Banner */}
            <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50/70 p-2.5 dark:border-brand-900/60 dark:bg-brand-950/30">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">
                  Standardized Exam Name
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  Assigned Number: #{String(testNumber).padStart(2, "0")}
                </span>
              </div>
              {manualNameOverride ? (
                <input
                  className="input mt-1.5 font-medium text-xs text-slate-900 dark:text-slate-100"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Override exam title..."
                />
              ) : (
                <p className="mt-1 font-mono text-sm font-bold text-brand-900 dark:text-brand-100">
                  {name}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Exam Date
              </label>
              <input
                type="date"
                className="input text-sm"
                value={examDate}
                onChange={(e) => setExamDate(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                Exam Mode
              </label>
              <select className="input text-sm" value={mode} onChange={(e) => setMode(e.target.value as ExamMode)}>
                <option value="normal">Normal — one attempt, manually scored</option>
                <option value="until_perfect">Until Perfect 10 — retake until 10/10</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Description (Optional)
            </label>
            <textarea
              className="input text-sm"
              placeholder="Description or guidance for agents..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Assigned Agents Preservation Feedback */}
          {examId && assignedAgentIds.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
              <Users className="h-3.5 w-3.5 text-brand-600" />
              <span>
                <strong>{assignedAgentIds.length}</strong> {assignedAgentIds.length === 1 ? "agent" : "agents"} currently assigned · assignments will be preserved upon saving.
              </span>
            </div>
          )}
        </div>

        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">
            Selected Questions ({selected.length})
          </h2>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs shadow-sm"
            onClick={() => setExamImportOpen(true)}
            title="Import questions directly from an Excel file for this test"
          >
            <Upload className="h-3.5 w-3.5" /> Import Questions for This Test
          </button>
        </div>
        {selected.length === 0 ? (
          <EmptyState title="No questions selected" subtitle="Click questions on the left to add them here." />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={selected.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {selected.map((q) => (
                  <SortableQuestionItem
                    key={q.id}
                    question={q}
                    onRemove={() => toggleSelect(q)}
                    onUpdate={(updated) =>
                      setSelected((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <div className="mt-4 flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => handleSave(false)} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Save className="mr-1.5 h-4 w-4" />
                {examId ? (status === "draft" ? "Save draft" : "Save changes") : "Save draft"}
              </>
            )}
          </button>
          <button className="btn-primary flex-1" onClick={() => handleSave(true)} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Publishing...
              </>
            ) : (
              <>
                <Rocket className="mr-1.5 h-4 w-4" />
                {status === "published" ? "Update published" : "Publish"}
              </>
            )}
          </button>
        </div>
      </div>

      <ExamQuestionImportModal
        open={examImportOpen}
        onClose={() => setExamImportOpen(false)}
        onQuestionsImported={handleExamQuestionsImported}
      />
    </div>
  );
}

