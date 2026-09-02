"use client";

import React, { useState, useRef, useMemo } from "react";
import {
  Bold,
  Italic,
  Code,
  List,
  ListOrdered,
  Quote,
  Eye,
  Edit3,
  FileCode,
  Copy,
  Check,
} from "lucide-react";

/* =========================================================================
   INLINE MARKDOWN PARSER
   ========================================================================= */
function parseInline(text: string): React.ReactNode[] {
  if (!text) return [];

  // Match bold (**text** or __text__), italic (*text* or _text_), code (`text`), strikethrough (~~text~~)
  const regex = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|~~[^~]+~~|\*[^*]+\*|_[^_]+_)/g;
  const parts = text.split(regex);

  return parts.map((part, index) => {
    if (!part) return null;

    if (
      (part.startsWith("**") && part.endsWith("**") && part.length >= 4) ||
      (part.startsWith("__") && part.endsWith("__") && part.length >= 4)
    ) {
      return (
        <strong key={index} className="font-semibold text-slate-900 dark:text-slate-100">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={index}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-indigo-600 dark:bg-slate-800 dark:text-indigo-300"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    if (part.startsWith("~~") && part.endsWith("~~") && part.length >= 4) {
      return (
        <del key={index} className="text-slate-400">
          {part.slice(2, -2)}
        </del>
      );
    }

    if (
      (part.startsWith("*") && part.endsWith("*") && part.length >= 2) ||
      (part.startsWith("_") && part.endsWith("_") && part.length >= 2)
    ) {
      return (
        <em key={index} className="italic text-slate-800 dark:text-slate-200">
          {part.slice(1, -1)}
        </em>
      );
    }

    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

/* =========================================================================
   BLOCK MARKDOWN RENDERER
   ========================================================================= */
interface MarkdownRendererProps {
  content?: string | null;
  className?: string;
}

export function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  if (!content) return null;

  // Split by code blocks first
  const blocks = useMemo(() => {
    const lines = content.split("\n");
    const result: Array<{
      type: "code" | "quote" | "h1" | "h2" | "h3" | "ul" | "ol" | "paragraph" | "divider";
      content: string | string[];
      language?: string;
    }> = [];

    let inCodeBlock = false;
    let codeLines: string[] = [];
    let codeLang = "";
    let currentList: string[] = [];
    let listType: "ul" | "ol" | null = null;

    function flushList() {
      if (listType && currentList.length > 0) {
        result.push({ type: listType, content: [...currentList] });
        currentList = [];
        listType = null;
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code block start/end
      if (line.trim().startsWith("```")) {
        if (inCodeBlock) {
          result.push({
            type: "code",
            content: codeLines.join("\n"),
            language: codeLang,
          });
          codeLines = [];
          codeLang = "";
          inCodeBlock = false;
        } else {
          flushList();
          inCodeBlock = true;
          codeLang = line.trim().slice(3).trim();
        }
        continue;
      }

      if (inCodeBlock) {
        codeLines.push(line);
        continue;
      }

      // Horizontal rule / divider
      if (line.trim() === "---" || line.trim() === "***" || line.trim() === "___") {
        flushList();
        result.push({ type: "divider", content: "" });
        continue;
      }

      // Headings
      if (line.startsWith("### ")) {
        flushList();
        result.push({ type: "h3", content: line.slice(4) });
        continue;
      }
      if (line.startsWith("## ")) {
        flushList();
        result.push({ type: "h2", content: line.slice(3) });
        continue;
      }
      if (line.startsWith("# ")) {
        flushList();
        result.push({ type: "h1", content: line.slice(2) });
        continue;
      }

      // Blockquote
      if (line.startsWith("> ")) {
        flushList();
        result.push({ type: "quote", content: line.slice(2) });
        continue;
      }

      // Bullet List item
      const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)$/);
      if (bulletMatch) {
        if (listType !== "ul") {
          flushList();
          listType = "ul";
        }
        currentList.push(bulletMatch[2]);
        continue;
      }

      // Numbered List item
      const numberedMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
      if (numberedMatch) {
        if (listType !== "ol") {
          flushList();
          listType = "ol";
        }
        currentList.push(numberedMatch[2]);
        continue;
      }

      // Non-list line encountered
      flushList();
      result.push({ type: "paragraph", content: line });
    }

    if (inCodeBlock && codeLines.length > 0) {
      result.push({
        type: "code",
        content: codeLines.join("\n"),
        language: codeLang,
      });
    }

    flushList();
    return result;
  }, [content]);

  return (
    <div className={`space-y-2 text-inherit leading-relaxed ${className}`}>
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <CodeBlockViewer
              key={index}
              code={block.content as string}
              language={block.language}
            />
          );
        }

        if (block.type === "divider") {
          return (
            <hr
              key={index}
              className="my-3 border-slate-200 dark:border-slate-700"
            />
          );
        }

        if (block.type === "h1") {
          return (
            <h3
              key={index}
              className="text-lg font-bold text-slate-900 dark:text-slate-100"
            >
              {parseInline(block.content as string)}
            </h3>
          );
        }

        if (block.type === "h2") {
          return (
            <h4
              key={index}
              className="text-base font-semibold text-slate-900 dark:text-slate-100"
            >
              {parseInline(block.content as string)}
            </h4>
          );
        }

        if (block.type === "h3") {
          return (
            <h5
              key={index}
              className="text-sm font-semibold text-slate-800 dark:text-slate-200"
            >
              {parseInline(block.content as string)}
            </h5>
          );
        }

        if (block.type === "quote") {
          return (
            <blockquote
              key={index}
              className="border-l-4 border-indigo-500 bg-slate-50 py-1.5 pl-3 pr-2 italic text-slate-700 dark:bg-slate-800/60 dark:text-slate-300 rounded-r"
            >
              {parseInline(block.content as string)}
            </blockquote>
          );
        }

        if (block.type === "ul") {
          return (
            <ul
              key={index}
              className="list-disc space-y-1 pl-5 text-inherit"
            >
              {(block.content as string[]).map((item, itemIdx) => (
                <li key={itemIdx}>{parseInline(item)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "ol") {
          return (
            <ol
              key={index}
              className="list-decimal space-y-1 pl-5 text-inherit"
            >
              {(block.content as string[]).map((item, itemIdx) => (
                <li key={itemIdx}>{parseInline(item)}</li>
              ))}
            </ol>
          );
        }

        // Paragraph with preserved whitespace
        const lineContent = block.content as string;
        if (!lineContent.trim()) {
          return <div key={index} className="h-2" />;
        }

        return (
          <p
            key={index}
            className="whitespace-pre-wrap break-words text-inherit"
          >
            {parseInline(lineContent)}
          </p>
        );
      })}
    </div>
  );
}

function CodeBlockViewer({
  code,
  language,
}: {
  code: string;
  language?: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative my-2 overflow-hidden rounded-lg border border-slate-700 bg-slate-900 text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-400">
        <span className="font-mono">{language || "code"}</span>
        <button
          type="button"
          className="flex items-center gap-1 text-slate-400 hover:text-slate-200"
          onClick={handleCopy}
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-green-400" />
              <span className="text-green-400">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-slate-200">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/* =========================================================================
   RICH MARKDOWN EDITOR
   ========================================================================= */
interface MarkdownEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  minHeight?: string;
  required?: boolean;
  disabled?: boolean;
  label?: string;
  className?: string;
  id?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write in markdown format...",
  minHeight = "min-h-[140px]",
  required = false,
  disabled = false,
  label,
  className = "",
  id,
}: MarkdownEditorProps) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function insertFormatting(prefix: string, suffix: string = "", defaultText: string = "") {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const currentVal = textarea.value;

    const selectedText = currentVal.substring(start, end) || defaultText;
    const replacement = `${prefix}${selectedText}${suffix}`;

    const nextVal =
      currentVal.substring(0, start) +
      replacement +
      currentVal.substring(end);

    onChange(nextVal);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(
        start + prefix.length,
        start + prefix.length + selectedText.length
      );
    }, 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        insertFormatting("**", "**", "bold text");
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        insertFormatting("*", "*", "italic text");
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        insertFormatting("`", "`", "code");
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      insertFormatting("  ", "");
    }
  }

  return (
    <div className={`overflow-hidden rounded-xl border border-slate-200 bg-white transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900 ${className}`}>
      {/* TOOLBAR */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-100 bg-slate-50/80 px-2 py-1.5 text-xs dark:border-slate-800 dark:bg-slate-800/50">
        <div className="flex flex-wrap items-center gap-1">
          {label && (
            <span className="mr-2 font-semibold text-slate-700 dark:text-slate-300">
              {label}
            </span>
          )}

          {tab === "write" && !disabled && (
            <>
              <button
                type="button"
                className="rounded p-1 text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
                onClick={() => insertFormatting("**", "**", "bold text")}
                title="Bold (Ctrl+B)"
              >
                <Bold className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                className="rounded p-1 text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
                onClick={() => insertFormatting("*", "*", "italic text")}
                title="Italic (Ctrl+I)"
              >
                <Italic className="h-3.5 w-3.5" />
              </button>

              <div className="mx-1 h-3.5 w-[1px] bg-slate-300 dark:bg-slate-700" />

              <button
                type="button"
                className="rounded p-1 text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
                onClick={() => insertFormatting("`", "`", "code")}
                title="Inline Code"
              >
                <Code className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                className="rounded p-1 text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
                onClick={() => insertFormatting("```\n", "\n```", "code snippet")}
                title="Code Block"
              >
                <FileCode className="h-3.5 w-3.5" />
              </button>

              <div className="mx-1 h-3.5 w-[1px] bg-slate-300 dark:bg-slate-700" />

              <button
                type="button"
                className="rounded p-1 text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
                onClick={() => insertFormatting("\n- ", "", "list item")}
                title="Bulleted List"
              >
                <List className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                className="rounded p-1 text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
                onClick={() => insertFormatting("\n1. ", "", "list item")}
                title="Numbered List"
              >
                <ListOrdered className="h-3.5 w-3.5" />
              </button>

              <button
                type="button"
                className="rounded p-1 text-slate-600 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
                onClick={() => insertFormatting("\n> ", "", "quote")}
                title="Blockquote"
              >
                <Quote className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>

        {/* TAB TOGGLE: WRITE vs PREVIEW */}
        <div className="flex items-center rounded-lg bg-slate-200/70 p-0.5 dark:bg-slate-700/60">
          <button
            type="button"
            className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition ${
              tab === "write"
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
            onClick={() => setTab("write")}
          >
            <Edit3 className="h-3 w-3" />
            Write
          </button>
          <button
            type="button"
            className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium transition ${
              tab === "preview"
                ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-slate-100"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
            onClick={() => setTab("preview")}
          >
            <Eye className="h-3 w-3" />
            Preview
          </button>
        </div>
      </div>

      {/* CONTENT AREA */}
      {tab === "write" ? (
        <textarea
          id={id}
          ref={textareaRef}
          className={`w-full resize-y border-0 bg-transparent p-3 text-sm leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0 dark:text-slate-100 dark:placeholder:text-slate-500 ${minHeight}`}
          value={value}
          disabled={disabled}
          required={required}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <div className={`p-3 text-sm dark:text-slate-200 ${minHeight} bg-slate-50/40 dark:bg-slate-900/40 overflow-y-auto`}>
          {value.trim() ? (
            <MarkdownRenderer content={value} />
          ) : (
            <p className="italic text-slate-400">Nothing to preview</p>
          )}
        </div>
      )}
    </div>
  );
}
