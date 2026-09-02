"use client";

import { useState } from "react";
import type { Question, QuestionType, Difficulty } from "@/types";
import { createQuestion, updateQuestion } from "@/lib/questions";
import { useAuth } from "@/context/AuthContext";
import {
  Image as ImageIcon,
  Trash2,
  Link as LinkIcon,
} from "lucide-react";
import { MarkdownEditor } from "@/components/ui/Primitives";

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
  { value: "screen_recording", label: "Screen Recording Walkthrough" },
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
    setError("");
    setSaving(true);
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
        ? await updateQuestion(existing.id, base, profile.uid)
        : await createQuestion(base as any, profile.uid);
      onSaved(saved);
    } catch (err) {
      console.error("Failed to save question:", err);
      setError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}
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
        <label className="mb-1 block text-sm font-medium">Question Text</label>
        <MarkdownEditor
          value={questionText}
          onChange={setQuestionText}
          placeholder="Write question text (supports markdown, lists, bold, inline code, and code blocks)..."
          minHeight="min-h-[120px]"
          required
        />
      </div>

      {type === "screen_recording" && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 text-xs text-indigo-900 dark:border-indigo-900/50 dark:bg-indigo-950/20 dark:text-indigo-200">
          <p className="font-semibold text-sm text-indigo-700 dark:text-indigo-300">Screen Recording Walkthrough</p>
          <p className="mt-1 text-slate-600 dark:text-slate-400">
            Agents will be prompted to provide an external workflow recording link (Loom, Screencast.com, TechSmith Snagit Cloud, Google Drive, YouTube, Vimeo, etc.). Use the Expected Answer field below to describe the key rubric checkpoints auditors will look for during manual review.
          </p>
        </div>
      )}

      {type === "case_study" && (
        <div>
          <label className="mb-1 block text-sm font-medium">Case / Ticket Context (Markdown)</label>
          <MarkdownEditor
            value={caseStudyContext}
            onChange={setCaseStudyContext}
            placeholder="Paste the ticket transcript, user dialogue, scenario logs, or steps..."
            minHeight="min-h-[150px]"
          />
        </div>
      )}

      {type === "image_based" && (
        <div className="space-y-2">
          <label className="mb-1 block text-sm font-medium">Question Image URL</label>

          {imageUrl ? (
            <div className="relative rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="relative h-40 w-full sm:w-60 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                  <img
                    src={imageUrl}
                    alt="Question illustration"
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="space-y-2 flex-1 min-w-0">
                  <p className="text-xs text-slate-500 break-all">{imageUrl}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-secondary text-xs text-red-500"
                      onClick={() => setImageUrl("")}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove Image
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="url"
                  className="input flex-1"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://... (external image URL, e.g. CDN, Imgur, Cloudinary, Drive)"
                />
              </div>
              <p className="text-xs text-slate-400">
                Paste a publicly accessible image link (.png, .jpg, .webp, .gif).
              </p>
            </div>
          )}
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
            ? "Explanation / Rubric (for auditor reference)"
            : "Expected Answer / Rubric"}
        </label>
        <MarkdownEditor
          value={expectedAnswer}
          onChange={setExpectedAnswer}
          placeholder="Write expected model answer, rubric criteria, or explanation (supports markdown)..."
          minHeight="min-h-[120px]"
          required
        />
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
