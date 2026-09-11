"use client";

import { useState } from "react";
import type { Question, QuestionType, Difficulty } from "@/types";
import { createQuestion, updateQuestion } from "@/lib/questions";
import { useAuth } from "@/context/AuthContext";
import { QuestionContent } from "./QuestionContent";
import { WordQuestionEditorModal } from "./WordQuestionEditorModal";
import {
  CONTROLLED_MODULES,
  ControlledModule,
  MODULE_TOPICS,
  normalizeLegacyModule,
  classifyQuestionTaxonomy,
} from "@/config/taxonomy";
import { Edit3, Sparkles } from "lucide-react";

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

  // Controlled Module state (normalized from legacy if present)
  const [module, setModule] = useState<ControlledModule>(() => {
    if (existing?.module) return normalizeLegacyModule(existing.module);
    return "RCM & Clinical";
  });

  // Controlled Topic state
  const [topic, setTopic] = useState(() => {
    return existing?.topic || existing?.feature || "";
  });
  const [customTopic, setCustomTopic] = useState(false);

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
  const [isFormattingOpen, setIsFormattingOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [suggestionNotice, setSuggestionNotice] = useState<string | null>(null);

  // Available topics for selected module
  const availableTopics = MODULE_TOPICS[module] || [];

  function handleSuggestTopic() {
    if (!questionText.trim()) {
      setSuggestionNotice("Please enter some question text first.");
      setTimeout(() => setSuggestionNotice(null), 3000);
      return;
    }

    const result = classifyQuestionTaxonomy(questionText, expectedAnswer, module, topic);
    setModule(result.suggestedModule);
    setTopic(result.suggestedTopic);
    setCustomTopic(false);

    // Merge suggested tags if not already present
    if (result.suggestedTags.length > 0) {
      const currentTagsList = tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
      const newTags = result.suggestedTags.filter((st) => !currentTagsList.includes(st.toLowerCase()));
      if (newTags.length > 0) {
        setTags((prev) => (prev.trim() ? `${prev.trim()}, ${newTags.join(", ")}` : newTags.join(", ")));
      }
    }

    setSuggestionNotice(
      `Suggested: "${result.suggestedTopic}" (${result.confidence} confidence: ${result.reason})`
    );
    setTimeout(() => setSuggestionNotice(null), 6000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    const finalTopic = topic.trim() || "General";
    setSaving(true);
    setError("");
    const base = {
      module: module.trim(),
      topic: finalTopic,
      feature: finalTopic, // Maintain feature in sync for 100% backward compatibility
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
      {/* Smart Topic Suggestion Feedback Banner */}
      {suggestionNotice && (
        <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50/80 px-3 py-2 text-xs font-medium text-brand-900 shadow-sm animate-in fade-in dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-300">
          <Sparkles className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
          <span>{suggestionNotice}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {/* Controlled Module Dropdown */}
        <div>
          <label className="mb-1 block text-sm font-medium">Module</label>
          <select
            className="input font-medium"
            value={module}
            onChange={(e) => {
              const newMod = e.target.value as ControlledModule;
              setModule(newMod);
              // Reset topic if not present in new module
              const newTopics = MODULE_TOPICS[newMod] || [];
              if (!newTopics.some((t) => t.name === topic)) {
                setTopic(newTopics[0]?.name || "");
              }
            }}
            required
          >
            {CONTROLLED_MODULES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* Controlled Topic Dropdown (Filtered by Module) */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-sm font-medium">Topic</label>
            <button
              type="button"
              onClick={() => setCustomTopic((prev) => !prev)}
              className="text-[11px] font-medium text-brand-600 hover:underline dark:text-brand-400"
            >
              {customTopic ? "Choose from list" : "+ Custom topic"}
            </button>
          </div>
          {customTopic ? (
            <input
              className="input text-sm"
              placeholder="Enter custom workflow topic..."
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              required
            />
          ) : (
            <select
              className="input text-sm"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              required
            >
              <option value="">Select Topic...</option>
              {availableTopics.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
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
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="scenario-based, verified, D2110, billing" />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-sm font-medium">Question Text</label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSuggestTopic}
              className="flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/60"
              title="Automatically detect topic and tags based on question keywords"
            >
              <Sparkles className="h-3 w-3 text-amber-600 dark:text-amber-400" />
              <span>Suggest Topic</span>
            </button>
            <button
              type="button"
              onClick={() => setIsFormattingOpen(true)}
              className="flex items-center gap-1 rounded bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
              title="Open Word-like formatting editor"
            >
              <Edit3 className="h-3 w-3" />
              <span>Format in Word Editor</span>
            </button>
          </div>
        </div>
        <textarea
          className="input min-h-[100px] font-mono text-xs leading-relaxed"
          value={questionText}
          onChange={(e) => setQuestionText(e.target.value)}
          required
          placeholder="Enter question text or use Word formatting tools..."
        />
        {questionText.trim() && (
          <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-900/40">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Agent Live Preview
            </p>
            <QuestionContent content={questionText} className="text-sm" />
          </div>
        )}
      </div>

      {isFormattingOpen && (
        <WordQuestionEditorModal
          open={isFormattingOpen}
          onClose={() => setIsFormattingOpen(false)}
          question={{
            id: existing?.id ?? "preview",
            module: module || "General",
            difficulty,
            type,
            questionText,
          }}
          onSave={(newText) => setQuestionText(newText)}
        />
      )}

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
