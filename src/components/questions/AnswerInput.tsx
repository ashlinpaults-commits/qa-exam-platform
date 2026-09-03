"use client";

import type { Question } from "@/types";
import { QuestionContent } from "./QuestionContent";

// Renders the correct input control for each of the 6 question types when an
// agent is taking an exam. Always stores answer as a string (JSON-encoded for
// structured types like mcq/drag-order) so AttemptAnswer.agentAnswer stays uniform.
export function AnswerInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string;
  onChange: (v: string) => void;
}) {
  switch (question.type) {
    case "mcq": {
      const selected = value ? Number(value) : null;
      return (
        <div className="space-y-2">
          {(question.options ?? []).map((opt, i) => (
            <label
              key={i}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm transition ${
                selected === i
                  ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                  : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              }`}
            >
              <input
                type="radio"
                name={`mcq-${question.id}`}
                checked={selected === i}
                onChange={() => onChange(String(i))}
              />
              {opt}
            </label>
          ))}
        </div>
      );
    }
    case "true_false":
      return (
        <div className="flex gap-3">
          {["True", "False"].map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => onChange(label)}
              className={value === label ? "btn-primary" : "btn-secondary"}
            >
              {label}
            </button>
          ))}
        </div>
      );
    case "image_based":
      return (
        <div className="space-y-3">
          {question.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={question.imageUrl} alt="Question reference" className="max-h-96 rounded-xl border border-slate-200" />
          )}
          <textarea
            className="input min-h-[120px]"
            placeholder="Describe what you see / your answer..."
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case "case_study":
      return (
        <div className="space-y-3">
          {question.caseStudyContext && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-800/80">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Ticket / Case Context
              </p>
              <QuestionContent content={question.caseStudyContext} className="text-sm text-slate-700 dark:text-slate-300" />
            </div>
          )}
          <textarea
            className="input min-h-[140px]"
            placeholder="Your answer..."
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    case "drag_drop_order": {
      const items: string[] = value ? JSON.parse(value) : question.orderItems ?? [];
      function move(i: number, dir: -1 | 1) {
        const copy = [...items];
        const j = i + dir;
        if (j < 0 || j >= copy.length) return;
        [copy[i], copy[j]] = [copy[j], copy[i]];
        onChange(JSON.stringify(copy));
      }
      return (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">Use the arrows to arrange in the correct order.</p>
          {items.map((item, i) => (
            <div
              key={item + i}
              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              <span>{i + 1}. {item}</span>
              <div className="flex gap-1">
                <button type="button" className="btn-secondary px-2 py-1" onClick={() => move(i, -1)}>↑</button>
                <button type="button" className="btn-secondary px-2 py-1" onClick={() => move(i, 1)}>↓</button>
              </div>
            </div>
          ))}
        </div>
      );
    }
    case "descriptive":
    default:
      return (
        <textarea
          className="input min-h-[160px]"
          placeholder="Type your answer..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
