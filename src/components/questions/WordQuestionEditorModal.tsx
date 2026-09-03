"use client";

import { useState, useRef } from "react";
import type { Question } from "@/types";
import { Modal, Badge } from "@/components/ui/Primitives";
import { QuestionContent } from "./QuestionContent";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Highlighter,
  Palette,
  AlignLeft,
  AlignCenter,
  AlignRight,
  List,
  ListOrdered,
  Indent,
  Table,
  Eye,
  Type,
  Check,
} from "lucide-react";

interface WordQuestionEditorModalProps {
  open: boolean;
  onClose: () => void;
  question: Pick<Question, "id" | "module" | "difficulty" | "type" | "questionText">;
  onSave: (updatedQuestionText: string) => void;
}

const TEXT_COLORS = [
  { label: "Default", value: "" },
  { label: "Crimson Red", value: "#DC2626" },
  { label: "Blue", value: "#2563EB" },
  { label: "Emerald Green", value: "#059669" },
  { label: "Amber Orange", value: "#D97706" },
  { label: "Purple", value: "#7C3AED" },
];

const HIGHLIGHT_COLORS = [
  { label: "None", value: "" },
  { label: "Yellow", value: "#FEF08A" },
  { label: "Cyan", value: "#A5F3FC" },
  { label: "Light Green", value: "#BBF7D0" },
  { label: "Pink", value: "#FBCFE8" },
];

export function WordQuestionEditorModal({
  open,
  onClose,
  question,
  onSave,
}: WordQuestionEditorModalProps) {
  const [text, setText] = useState(question.questionText);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [fontSize, setFontSize] = useState("normal");
  const [fontFamily, setFontFamily] = useState("default");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function wrapSelection(prefix: string, suffix: string, placeholder = "text") {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = text.slice(start, end) || placeholder;

    const before = text.slice(0, start);
    const after = text.slice(end);

    const replacement = `${prefix}${selected}${suffix}`;
    const nextText = `${before}${replacement}${after}`;
    setText(nextText);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + prefix.length,
        start + prefix.length + selected.length
      );
    }, 0);
  }

  function applyPrefixToLines(prefixGen: (lineIdx: number) => string) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = text.slice(start, end);

    const lines = selected ? selected.split("\n") : ["Item"];
    const transformed = lines.map((l, i) => `${prefixGen(i)}${l}`).join("\n");

    const before = text.slice(0, start);
    const after = text.slice(end);

    const nextText = `${before}${transformed}${after}`;
    setText(nextText);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + transformed.length);
    }, 0);
  }

  function handleInsertTable() {
    const tableTemplate = `
| Column 1 | Column 2 | Column 3 |
| --- | --- | --- |
| Detail A | Detail B | Detail C |
| Detail D | Detail E | Detail F |
`.trim();

    const textarea = textareaRef.current;
    if (!textarea) {
      setText((prev) => `${prev}\n\n${tableTemplate}`);
      return;
    }

    const start = textarea.selectionStart;
    const before = text.slice(0, start);
    const after = text.slice(start);

    const insertBlock = `\n\n${tableTemplate}\n\n`;
    setText(`${before}${insertBlock}${after}`);
  }

  function handleSave() {
    onSave(text);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Word-Like Question Editor & Formatter"
      wide
    >
      <div className="space-y-4 text-xs">
        {/* Question Metadata Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Badge color="brand">{question.module}</Badge>
            <Badge>{question.difficulty}</Badge>
            <Badge color="slate">{question.type.replace(/_/g, " ")}</Badge>
          </div>
          <span className="font-mono text-[11px] text-slate-400">ID: {question.id}</span>
        </div>

        {/* Word-Like Toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800/80">
          {/* Font Family Dropdown */}
          <div className="flex items-center gap-1">
            <Type className="h-3.5 w-3.5 text-slate-400" />
            <select
              className="h-7 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              value={fontFamily}
              onChange={(e) => {
                const f = e.target.value;
                setFontFamily(f);
                if (f !== "default") {
                  wrapSelection(`[font:${f}]`, `[/font]`);
                }
              }}
              title="Font Family"
            >
              <option value="default">Default Font</option>
              <option value="serif">Serif (Times / Georgia)</option>
              <option value="mono">Monospace (Courier / Code)</option>
              <option value="sans">Sans-serif (Arial)</option>
              <option value="comic">Chalkboard / Comic</option>
            </select>
          </div>

          {/* Font Size Dropdown */}
          <select
            className="h-7 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            value={fontSize}
            onChange={(e) => {
              const sz = e.target.value;
              setFontSize(sz);
              if (sz !== "normal") {
                wrapSelection(`[size:${sz}]`, `[/size]`);
              }
            }}
            title="Font Size"
          >
            <option value="normal">Size: Normal</option>
            <option value="small">Size: Small</option>
            <option value="medium">Size: Medium</option>
            <option value="large">Size: Large</option>
            <option value="xlarge">Size: Extra Large</option>
          </select>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Inline Styles: B, I, U, S */}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            onClick={() => wrapSelection("**", "**")}
            title="Bold (Ctrl+B)"
          >
            <Bold className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            onClick={() => wrapSelection("*", "*")}
            title="Italic (Ctrl+I)"
          >
            <Italic className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            onClick={() => wrapSelection("<u>", "</u>")}
            title="Underline (Ctrl+U)"
          >
            <Underline className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            onClick={() => wrapSelection("~~", "~~")}
            title="Strikethrough"
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </button>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Text Color Picker */}
          <div className="relative">
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              onClick={() => {
                setShowColorPicker(!showColorPicker);
                setShowHighlightPicker(false);
              }}
              title="Text Color"
            >
              <Palette className="h-3.5 w-3.5 text-brand-600" />
              <span>Color</span>
            </button>
            {showColorPicker && (
              <div className="absolute left-0 top-8 z-30 flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    className="flex items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-700"
                    onClick={() => {
                      if (c.value) wrapSelection(`[color:${c.value}]`, `[/color]`);
                      setShowColorPicker(false);
                    }}
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-slate-300"
                      style={{ backgroundColor: c.value || "#000000" }}
                    />
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Highlight Picker */}
          <div className="relative">
            <button
              type="button"
              className="flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
              onClick={() => {
                setShowHighlightPicker(!showHighlightPicker);
                setShowColorPicker(false);
              }}
              title="Highlight Background"
            >
              <Highlighter className="h-3.5 w-3.5 text-amber-500" />
              <span>Highlight</span>
            </button>
            {showHighlightPicker && (
              <div className="absolute left-0 top-8 z-30 flex flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                {HIGHLIGHT_COLORS.map((h) => (
                  <button
                    key={h.label}
                    type="button"
                    className="flex items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-slate-100 dark:hover:bg-slate-700"
                    onClick={() => {
                      if (h.value) wrapSelection(`[highlight:${h.value}]`, `[/highlight]`);
                      else wrapSelection("==", "==");
                      setShowHighlightPicker(false);
                    }}
                  >
                    <span
                      className="h-3 w-3 rounded border border-slate-300"
                      style={{ backgroundColor: h.value || "#FEF08A" }}
                    />
                    <span>{h.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Alignment: Left, Center, Right */}
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            onClick={() => wrapSelection("[align:left]", "[/align]")}
            title="Align Left"
          >
            <AlignLeft className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            onClick={() => wrapSelection("[align:center]", "[/align]")}
            title="Center Text"
          >
            <AlignCenter className="h-3.5 w-3.5" />
          </button>

          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            onClick={() => wrapSelection("[align:right]", "[/align]")}
            title="Align Right"
          >
            <AlignRight className="h-3.5 w-3.5" />
          </button>

          <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />

          {/* Lists: Bullets, Numbered */}
          <button
            type="button"
            className="flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            onClick={() => applyPrefixToLines(() => "• ")}
            title="Bullet List"
          >
            <List className="h-3.5 w-3.5" />
            <span>List</span>
          </button>

          <button
            type="button"
            className="flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            onClick={() => applyPrefixToLines((idx) => `${idx + 1}. `)}
            title="Numbered List"
          >
            <ListOrdered className="h-3.5 w-3.5" />
            <span>1. List</span>
          </button>

          {/* Indent / Callout */}
          <button
            type="button"
            className="flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            onClick={() => wrapSelection("[indent]\n", "\n[/indent]")}
            title="Indent / Scenario Block"
          >
            <Indent className="h-3.5 w-3.5" />
            <span>Indent</span>
          </button>

          {/* Table */}
          <button
            type="button"
            className="flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            onClick={handleInsertTable}
            title="Insert Structured Table"
          >
            <Table className="h-3.5 w-3.5" />
            <span>Table</span>
          </button>
        </div>

        {/* Main Editor Textarea */}
        <div>
          <label className="mb-1 block font-semibold uppercase tracking-wider text-slate-500 text-[10px]">
            Question Text & Structure
          </label>
          <textarea
            ref={textareaRef}
            className="input min-h-[140px] font-mono text-xs leading-relaxed"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type or format your question here..."
          />
        </div>

        {/* Live Synchronous Preview */}
        <div className="rounded-xl border border-brand-200 bg-brand-50/20 p-3.5 dark:border-brand-800/50 dark:bg-brand-950/20">
          <div className="mb-2 flex items-center justify-between border-b border-brand-100 pb-1.5 dark:border-brand-900/50">
            <span className="flex items-center gap-1.5 font-bold uppercase tracking-wide text-brand-700 text-[11px] dark:text-brand-300">
              <Eye className="h-3.5 w-3.5" /> Live Preview — What the Agent Will See
            </span>
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-800 dark:bg-brand-900/60 dark:text-brand-200">
              Real-time QuestionContent
            </span>
          </div>
          <div className="rounded-lg bg-white p-3 shadow-sm dark:bg-slate-900">
            <QuestionContent content={text} className="text-sm" />
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary flex items-center gap-1.5" onClick={handleSave}>
            <Check className="h-3.5 w-3.5" />
            Apply & Save Formatting
          </button>
        </div>
      </div>
    </Modal>
  );
}