"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Question } from "@/types";
import { GripVertical, X } from "lucide-react";
import { Badge } from "@/components/ui/Primitives";

export function SortableQuestionItem({ question, onRemove }: { question: Question; onRemove: () => void }) {
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
      className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800"
    >
      <button {...attributes} {...listeners} className="cursor-grab text-slate-400 active:cursor-grabbing">
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex gap-1">
          <Badge color="brand">{question.module}</Badge>
          <Badge>{question.difficulty}</Badge>
        </div>
        <p className="truncate">{question.questionText}</p>
      </div>
      <button onClick={onRemove} className="shrink-0 text-slate-400 hover:text-red-500">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
