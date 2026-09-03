"use client";

import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Question } from "@/types";
import { GripVertical, X, ChevronDown, ChevronUp, Edit3 } from "lucide-react";
import { Badge } from "@/components/ui/Primitives";
import { QuestionContent } from "@/components/questions/QuestionContent";
import { WordQuestionEditorModal } from "@/components/questions/WordQuestionEditorModal";

interface SortableQuestionItemProps {
  question: Question;
  onRemove: () => void;
  onUpdate?: (updated: Question) => void;
}

export function SortableQuestionItem({
  question,
  onRemove,
  onUpdate,
}: SortableQuestionItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: question.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800"
    >
      <div className="flex items-center gap-2">
        <button {...attributes} {...listeners} className="cursor-grab text-slate-400 active:cursor-grabbing">
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5">
            <Badge color="brand">{question.module}</Badge>
            <Badge>{question.difficulty}</Badge>
            <Badge color="slate">{question.type.replace(/_/g, " ")}</Badge>
          </div>
          {!expanded && (
            <p className="cursor-pointer truncate text-slate-700 hover:text-slate-900 dark:text-slate-300" onClick={() => setExpanded(true)}>
              {question.questionText}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="shrink-0 flex items-center gap-1 rounded bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100 dark:bg-brand-950/40 dark:text-brand-300 dark:hover:bg-brand-900/60"
          title="Format question in Word-like editor"
        >
          <Edit3 className="h-3 w-3" />
          <span>Format</span>
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700"
          title={expanded ? "Collapse question" : "Preview full question"}
          aria-label={expanded ? "Collapse question" : "Preview full question"}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        <button onClick={onRemove} className="shrink-0 text-slate-400 hover:text-red-500" title="Remove from exam">
          <X className="h-4 w-4" />
        </button>
      </div>

      {expanded && (
        <div className="mt-2.5 rounded-lg border border-slate-100 bg-slate-50/80 p-3 text-xs dark:border-slate-700/60 dark:bg-slate-900/40">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Question Content</p>
          <QuestionContent content={question.questionText} className="text-xs" />
          {question.caseStudyContext && (
            <div className="mt-2 border-t border-slate-200/60 pt-2 dark:border-slate-700/60">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Case Context</p>
              <QuestionContent content={question.caseStudyContext} className="text-xs text-slate-600 dark:text-slate-400" />
            </div>
          )}
        </div>
      )}

      {isEditing && (
        <WordQuestionEditorModal
          open={isEditing}
          onClose={() => setIsEditing(false)}
          question={question}
          onSave={(newText) => {
            onUpdate?.({ ...question, questionText: newText });
          }}
        />
      )}
    </div>
  );
}
