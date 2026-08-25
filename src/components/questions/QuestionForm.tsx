"use client";

import { useState } from "react";
import type { Question, QuestionType, Difficulty } from "@/types";
import { createQuestion, updateQuestion } from "@/lib/questions";
import { useAuth } from "@/context/AuthContext";

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/permission/i.test(msg)) return "You don't have permission to save this question.";
  if (/undefined/i.test(msg)) return "One of the fields has an invalid empty value. Please check all fields and try again.";
  return `Couldn't save: ${msg}`;
}

const TYPES: { value: QuestionType; label: string }[] = [
  { value: "descriptive", label: "Descriptive" },
  { value: "mcq", label: "Multiple Choice" },
  { value: "true_false", label: "True / False" },
  { value: "image_based", label: "Image Based" },
  { value: "case_study", label: "Case Study" },
  { value: "drag_drop_order", label: "Drag & Drop Order" },
];

export function QuestionForm({
  existing,
  onSaved,
}: {
  existing?: Question | null;
  onSaved: (saved: Question) => void;
}) {
  const { profile } = useAuth();
  const [type, setType] = useState<QuestionType>(existing?.type ?? "descriptive");
  const [module, setModule] = useState(existing?.module ?? "");
  const [feature, setFeature] = useState(existing?.feature ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>(existing?.difficulty ?? "easy");
  const [tags, setTags] = useState(existing?.tags.join(", ") ?? "");
  const [questionText, setQuestionText] = useState(existing?.questionText ?? "");
  const [expectedAnswer, setExpectedAnswer] = useState(existing?.expectedAnswer ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [options, setOptions] = useState<string[]>(existing?.options ?? ["", ""]);
  const [correctOptionIndex, setCorrectOptionIndex] = useState(existing?.correctOptionIndex ?? 0);
  const [imageUrl, setImageUrl] = useState(existing?.imageUrl ?? "");
  const [caseStudyContext, setCaseStudyContext] = useState(existing?.caseStudyContext ?? "");
  const [orderItems, setOrderItems] = useState<string[]>(existing?.orderItems ?? ["", ""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    setError("");
    const base = {
      module: module.trim(),
      feature: feature.trim(),
      difficulty,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      type,
      questionText: questionText.trim(),
      expectedAnswer: expectedAnswer.trim(),
      notes: notes.trim() || undefined,
      options: type === "mcq" ? options.filter(Boolean) : undefined,
      correctOptionIndex: type === "mcq" ? correctOptionIndex : undefined,
      imageUrl: type === "image_based" ? imageUrl.trim() || undefined : undefined,
      caseStudyContext: type === "case_study" ? caseStudyContext.trim() : undefined,
      orderItems: type === "drag_drop_order" ? orderItems.filter(Boolean) : undefined,
    };
    try {
      const saved = existing
        ? await updateQuestion(existing.id, base)
        : await createQuestion(base as any, profile.uid);
      onSaved(saved);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Module</label>
          <input className="input" value={module} onChange={(e) => setModule(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Feature / Topic</label>
          <input className="input" value={feature} onChange={(e) => setFeature(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Difficulty</label>
          <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Question Type</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value as QuestionType)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Tags (comma separated)</label>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="scenario-based, verified" />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Question</label>
        <textarea className="input min-h-[100px]" value={questionText} onChange={(e) => setQuestionText(e.target.value)} required />
      </div>

      {type === "case_study" && (
        <div>
          <label className="mb-1 block text-sm font-medium">Case / Ticket Context</label>
          <textarea className="input min-h-[100px]" value={caseStudyContext} onChange={(e) => setCaseStudyContext(e.target.value)} placeholder="Paste the ticket transcript / scenario here..." />
        </div>
      )}

      {type === "image_based" && (
        <div>
          <label className="mb-1 block text-sm font-medium">Image URL</label>
          <input className="input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://... (upload via Firebase Storage, paste URL here)" />
        </div>
      )}

      {type === "mcq" && (
        <div className="space-y-2">
          <label className="mb-1 block text-sm font-medium">Options (select the correct one)</label>
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                checked={correctOptionIndex === i}
                onChange={() => setCorrectOptionIndex(i)}
              />
              <input
                className="input"
                value={opt}
                onChange={(e) => setOptions(options.map((o, j) => (j === i ? e.target.value : o)))}
                placeholder={`Option ${i + 1}`}
              />
              {options.length > 2 && (
                <button type="button" className="text-xs text-red-500" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                  remove
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn-secondary text-sm" onClick={() => setOptions([...options, ""])}>
            + Add option
          </button>
        </div>
      )}

      {type === "drag_drop_order" && (
        <div className="space-y-2">
          <label className="mb-1 block text-sm font-medium">Steps in correct order</label>
          {orderItems.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-sm text-slate-400">{i + 1}.</span>
              <input
                className="input"
                value={item}
                onChange={(e) => setOrderItems(orderItems.map((o, j) => (j === i ? e.target.value : o)))}
                placeholder={`Step ${i + 1}`}
              />
              {orderItems.length > 2 && (
                <button type="button" className="text-xs text-red-500" onClick={() => setOrderItems(orderItems.filter((_, j) => j !== i))}>
                  remove
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn-secondary text-sm" onClick={() => setOrderItems([...orderItems, ""])}>
            + Add step
          </button>
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium">
          {type === "mcq" || type === "true_false" || type === "drag_drop_order"
            ? "Explanation (for auditor reference)"
            : "Expected Answer"}
        </label>
        <textarea className="input min-h-[100px]" value={expectedAnswer} onChange={(e) => setExpectedAnswer(e.target.value)} required />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Notes (optional)</label>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <button type="submit" className="btn-primary w-full" disabled={saving}>
        {saving ? "Saving..." : existing ? "Save changes" : "Add question"}
      </button>
    </form>
  );
}
