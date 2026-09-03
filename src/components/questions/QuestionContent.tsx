"use client";

import React, { ReactNode, useMemo } from "react";

interface QuestionContentProps {
  content?: string;
  className?: string;
}

/**
 * Normalizes size specifications (e.g. "large", "16px", "1.2rem") to clean CSS styles.
 */
function getFontSizeStyle(sizeStr?: string): React.CSSProperties {
  if (!sizeStr) return {};
  const s = sizeStr.toLowerCase().trim();
  if (s === "small" || s === "sm") return { fontSize: "0.85rem" };
  if (s === "normal" || s === "base") return { fontSize: "1rem" };
  if (s === "medium" || s === "md") return { fontSize: "1.1rem" };
  if (s === "large" || s === "lg") return { fontSize: "1.25rem", lineHeight: "1.4" };
  if (s === "xlarge" || s === "xl") return { fontSize: "1.5rem", lineHeight: "1.3" };
  if (/^\d+(?:px|pt|em|rem|%)$/.test(s)) return { fontSize: s };
  return {};
}

/**
 * Normalizes font family names to standard web-safe font stacks.
 */
function getFontFamilyStyle(fontStr?: string): React.CSSProperties {
  if (!fontStr) return {};
  const f = fontStr.toLowerCase().trim();
  if (f.includes("serif") || f === "times" || f === "times new roman" || f === "georgia") {
    return { fontFamily: "Georgia, Cambria, 'Times New Roman', Times, serif" };
  }
  if (f.includes("mono") || f === "courier" || f === "consolas") {
    return { fontFamily: "'Courier New', Courier, Consolas, Menlo, monospace" };
  }
  if (f.includes("comic")) {
    return { fontFamily: "'Comic Sans MS', 'Chalkboard SE', cursive, sans-serif" };
  }
  if (f === "arial" || f === "helvetica" || f === "sans" || f.includes("sans-serif")) {
    return { fontFamily: "Arial, Helvetica, -apple-system, BlinkMacSystemFont, sans-serif" };
  }
  return { fontFamily: fontStr };
}

/**
 * Safely parses inline Word-like tokens into pure React elements without dangerouslySetInnerHTML.
 * Supported:
 * - Bold: **text**, <b>text</b>, <strong>text</strong>
 * - Italic: *text*, _text_, <i>text</i>, <em>text</em>
 * - Underline: <u>text</u>, ++text++, <ins>text</ins>
 * - Strikethrough: ~~text~~, <s>text</s>, <del>text</del>
 * - Highlight: ==text==, <mark>text</mark>, [highlight]text[/highlight], [highlight:#HEX]text[/highlight]
 * - Text color: [color:#HEX]text[/color], [color:NAME]text[/color]
 * - Font size: [size:large]text[/size], [size:16px]text[/size]
 * - Font family: [font:serif]text[/font], [font:mono]text[/font]
 * - Subscript: ~text~, <sub>text</sub>
 * - Superscript: ^text^, <sup>text</sup>
 * - Inline code: `code`
 */
export function parseInline(text: string): ReactNode[] {
  if (!text) return [];

  // Non-capturing inner regex for all inline tokens
  const tokenRegex = /(<b>[\s\S]*?<\/b>|<strong>[\s\S]*?<\/strong>|\*\*[^*]+?\*\*|<i>[\s\S]*?<\/i>|<em>[\s\S]*?<\/em>|(?<!\w)\*[^*\n]+?\*(?!\w)|<u>[\s\S]*?<\/u>|\+\+[\s\S]*?\+\+|<ins>[\s\S]*?<\/ins>|<s>[\s\S]*?<\/s>|~~[\s\S]*?~~|<del>[\s\S]*?<\/del>|==[\s\S]*?==|<mark>[\s\S]*?<\/mark>|\[highlight(?::(?:[^\]]+))?\][\s\S]*?\[\/highlight\]|\[color:(?:[^\]]+)\][\s\S]*?\[\/color\]|\[size:(?:[^\]]+)\][\s\S]*?\[\/size\]|\[font:(?:[^\]]+)\][\s\S]*?\[\/font\]|<sub>[\s\S]*?<\/sub>|~[^~\s]+?~|<sup>[\s\S]*?<\/sup>|\^[^\^\s]+?\^|`[^`]+?`)/g;

  const parts = text.split(tokenRegex);

  return parts.map((part, index) => {
    if (!part) return null;

    // Bold
    if (part.startsWith("<b>") && part.endsWith("</b>")) {
      return (
        <strong key={index} className="font-bold text-slate-900 dark:text-slate-100">
          {parseInline(part.slice(3, -4))}
        </strong>
      );
    }
    if (part.startsWith("<strong>") && part.endsWith("</strong>")) {
      return (
        <strong key={index} className="font-bold text-slate-900 dark:text-slate-100">
          {parseInline(part.slice(8, -9))}
        </strong>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return (
        <strong key={index} className="font-bold text-slate-900 dark:text-slate-100">
          {parseInline(part.slice(2, -2))}
        </strong>
      );
    }

    // Underline
    if (part.startsWith("<u>") && part.endsWith("</u>")) {
      return (
        <span key={index} className="underline decoration-1 underline-offset-2">
          {parseInline(part.slice(3, -4))}
        </span>
      );
    }
    if (part.startsWith("<ins>") && part.endsWith("</ins>")) {
      return (
        <span key={index} className="underline decoration-1 underline-offset-2">
          {parseInline(part.slice(5, -6))}
        </span>
      );
    }
    if (part.startsWith("++") && part.endsWith("++") && part.length >= 4) {
      return (
        <span key={index} className="underline decoration-1 underline-offset-2">
          {parseInline(part.slice(2, -2))}
        </span>
      );
    }

    // Italic
    if (part.startsWith("<i>") && part.endsWith("</i>")) {
      return (
        <em key={index} className="italic text-slate-800 dark:text-slate-200">
          {parseInline(part.slice(3, -4))}
        </em>
      );
    }
    if (part.startsWith("<em>") && part.endsWith("</em>")) {
      return (
        <em key={index} className="italic text-slate-800 dark:text-slate-200">
          {parseInline(part.slice(4, -5))}
        </em>
      );
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length >= 2) {
      return (
        <em key={index} className="italic text-slate-800 dark:text-slate-200">
          {parseInline(part.slice(1, -1))}
        </em>
      );
    }

    // Strikethrough
    if (part.startsWith("<s>") && part.endsWith("</s>")) {
      return (
        <span key={index} className="line-through text-slate-500">
          {parseInline(part.slice(3, -4))}
        </span>
      );
    }
    if (part.startsWith("<del>") && part.endsWith("</del>")) {
      return (
        <span key={index} className="line-through text-slate-500">
          {parseInline(part.slice(5, -6))}
        </span>
      );
    }
    if (part.startsWith("~~") && part.endsWith("~~") && part.length >= 4) {
      return (
        <span key={index} className="line-through text-slate-500">
          {parseInline(part.slice(2, -2))}
        </span>
      );
    }

    // Highlight
    if (part.startsWith("==") && part.endsWith("==") && part.length >= 4) {
      return (
        <mark
          key={index}
          className="rounded bg-yellow-200/80 px-1 py-0.5 font-medium text-slate-900 dark:bg-yellow-500/30 dark:text-yellow-200"
        >
          {parseInline(part.slice(2, -2))}
        </mark>
      );
    }
    if (part.startsWith("<mark>") && part.endsWith("</mark>")) {
      return (
        <mark
          key={index}
          className="rounded bg-yellow-200/80 px-1 py-0.5 font-medium text-slate-900 dark:bg-yellow-500/30 dark:text-yellow-200"
        >
          {parseInline(part.slice(6, -7))}
        </mark>
      );
    }
    if (/^\[highlight(?::(?:[^\]]+))?\]([\s\S]*?)\[\/highlight\]$/.test(part)) {
      const match = part.match(/^\[highlight(?::([^\]]+))?\]([\s\S]*?)\[\/highlight\]$/);
      const customBg = match?.[1];
      const inner = match?.[2] || "";
      return (
        <mark
          key={index}
          className="rounded bg-yellow-200/80 px-1 py-0.5 font-medium text-slate-900 dark:bg-yellow-500/30 dark:text-yellow-200"
          style={customBg ? { backgroundColor: customBg } : undefined}
        >
          {parseInline(inner)}
        </mark>
      );
    }

    // Text Color: [color:#DC2626]text[/color]
    if (/^\[color:(?:[^\]]+)\]([\s\S]*?)\[\/color\]$/.test(part)) {
      const match = part.match(/^\[color:([^\]]+)\]([\s\S]*?)\[\/color\]$/);
      const color = match?.[1];
      const inner = match?.[2] || "";
      return (
        <span key={index} style={{ color }}>
          {parseInline(inner)}
        </span>
      );
    }

    // Font Size: [size:large]text[/size]
    if (/^\[size:(?:[^\]]+)\]([\s\S]*?)\[\/size\]$/.test(part)) {
      const match = part.match(/^\[size:([^\]]+)\]([\s\S]*?)\[\/size\]$/);
      const sizeStr = match?.[1];
      const inner = match?.[2] || "";
      return (
        <span key={index} style={getFontSizeStyle(sizeStr)}>
          {parseInline(inner)}
        </span>
      );
    }

    // Font Family: [font:serif]text[/font]
    if (/^\[font:(?:[^\]]+)\]([\s\S]*?)\[\/font\]$/.test(part)) {
      const match = part.match(/^\[font:([^\]]+)\]([\s\S]*?)\[\/font\]$/);
      const fontStr = match?.[1];
      const inner = match?.[2] || "";
      return (
        <span key={index} style={getFontFamilyStyle(fontStr)}>
          {parseInline(inner)}
        </span>
      );
    }

    // Subscript: ~2~ or <sub>2</sub>
    if (part.startsWith("<sub>") && part.endsWith("</sub>")) {
      return (
        <sub key={index} className="text-[0.75em] align-sub">
          {parseInline(part.slice(5, -6))}
        </sub>
      );
    }
    if (part.startsWith("~") && part.endsWith("~") && part.length >= 2) {
      return (
        <sub key={index} className="text-[0.75em] align-sub">
          {parseInline(part.slice(1, -1))}
        </sub>
      );
    }

    // Superscript: ^2^ or <sup>2</sup>
    if (part.startsWith("<sup>") && part.endsWith("</sup>")) {
      return (
        <sup key={index} className="text-[0.75em] align-super">
          {parseInline(part.slice(5, -6))}
        </sup>
      );
    }
    if (part.startsWith("^") && part.endsWith("^") && part.length >= 2) {
      return (
        <sup key={index} className="text-[0.75em] align-super">
          {parseInline(part.slice(1, -1))}
        </sup>
      );
    }

    // Code
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      return (
        <code
          key={index}
          className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-200"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // Plain text
    return part;
  });
}

interface BlockItem {
  type: "paragraph" | "numbered-list" | "bullet-list" | "aligned" | "indent" | "table";
  lines?: string[];
  text?: string;
  align?: "left" | "center" | "right" | "justify";
  headers?: string[];
  rows?: string[][];
}

/**
 * Deconstructs plain or Word-like text into structured blocks (paragraphs, alignment,
 * indentation, tables, numbered steps, and bullet lists) while preserving line breaks.
 */
function parseBlocks(raw: string): BlockItem[] {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalized) return [];

  const rawBlocks = normalized.split(/\n{2,}/);
  const blocks: BlockItem[] = [];

  for (const block of rawBlocks) {
    const lines = block.split("\n").map((l) => l.trimEnd());
    if (lines.length === 0) continue;

    // Check for align tag: [align:center]...[/align]
    const alignMatch = block.match(/^\[align:(center|right|left|justify)\]([\s\S]*?)\[\/align\]$/);
    if (alignMatch) {
      blocks.push({
        type: "aligned",
        align: alignMatch[1] as BlockItem["align"],
        text: alignMatch[2].trim(),
      });
      continue;
    }

    // Check for indent tag: [indent]...[/indent]
    const indentMatch = block.match(/^\[indent\]([\s\S]*?)\[\/indent\]$/);
    if (indentMatch) {
      blocks.push({ type: "indent", text: indentMatch[1].trim() });
      continue;
    }

    // Check for Table: lines starting and ending with |
    if (lines.length >= 2 && lines.every((l) => l.trim().startsWith("|") && l.trim().endsWith("|"))) {
      const parsedRows = lines
        .filter((l) => !/^[\|\s\-:]+$/.test(l)) // drop markdown separator line | --- | --- |
        .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
      if (parsedRows.length > 0) {
        blocks.push({
          type: "table",
          headers: parsedRows[0],
          rows: parsedRows.slice(1),
        });
        continue;
      }
    }

    // Check if lines are numbered list items (e.g. "1. ", "2) ", "(1) ")
    const isNumbered = lines.every(
      (l) => !l.trim() || /^(\d+[\.\)]|\([0-9a-zA-Z]\)|[a-zA-Z][\.\)])\s+/.test(l.trim())
    );

    // Check if lines are bullet list items (e.g. "- ", "* ", "• ", "→ ")
    const isBullet = lines.every(
      (l) => !l.trim() || /^([-•*→·])\s+/.test(l.trim())
    );

    if (isNumbered && lines.some((l) => l.trim())) {
      blocks.push({ type: "numbered-list", lines: lines.filter((l) => l.trim()) });
    } else if (isBullet && lines.some((l) => l.trim())) {
      blocks.push({ type: "bullet-list", lines: lines.filter((l) => l.trim()) });
    } else {
      blocks.push({ type: "paragraph", text: lines.join("\n") });
    }
  }

  return blocks;
}

/**
 * QuestionContent: Safe, accessible React rendering for question text, clinical scenarios,
 * and case study contexts with Word-like formatting support.
 *
 * Preserves paragraphs, alignment, line breaks, indentation, tables, numbered steps,
 * and bullet lines without dangerouslySetInnerHTML.
 */
export function QuestionContent({ content, className = "" }: QuestionContentProps) {
  const blocks = useMemo(() => parseBlocks(content ?? ""), [content]);

  if (!content?.trim()) {
    return <p className="text-sm italic text-slate-400">No question text provided.</p>;
  }

  return (
    <div className={`space-y-3 text-slate-900 dark:text-slate-100 ${className}`}>
      {blocks.map((block, blockIndex) => {
        // Aligned text block
        if (block.type === "aligned") {
          const alignClass =
            block.align === "center"
              ? "text-center"
              : block.align === "right"
              ? "text-right"
              : block.align === "justify"
              ? "text-justify"
              : "text-left";

          return (
            <div key={blockIndex} className={`my-2 leading-relaxed ${alignClass}`}>
              {parseInline(block.text || "")}
            </div>
          );
        }

        // Indented text block (quoted block/indented scenario)
        if (block.type === "indent") {
          return (
            <div
              key={blockIndex}
              className="my-2 border-l-4 border-brand-300 bg-brand-50/40 py-2 pl-4 text-slate-800 dark:border-brand-700 dark:bg-brand-950/20 dark:text-slate-200"
            >
              {parseInline(block.text || "")}
            </div>
          );
        }

        // Table block
        if (block.type === "table" && block.headers) {
          return (
            <div
              key={blockIndex}
              className="my-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700"
            >
              <table className="min-w-full divide-y divide-slate-200 text-xs dark:divide-slate-700">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    {block.headers.map((h, i) => (
                      <th
                        key={i}
                        className="px-3 py-2 text-left font-semibold text-slate-700 dark:text-slate-200"
                      >
                        {parseInline(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900/50">
                  {block.rows?.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      className={rIdx % 2 === 0 ? "bg-white dark:bg-slate-900/30" : "bg-slate-50/50 dark:bg-slate-800/30"}
                    >
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-3 py-2 text-slate-700 dark:text-slate-300">
                          {parseInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        // Numbered list block
        if (block.type === "numbered-list" && block.lines) {
          return (
            <ol key={blockIndex} className="my-2 space-y-1.5 pl-0.5">
              {block.lines.map((line, lineIndex) => {
                const match = line.trim().match(/^(\d+[\.\)]|\([0-9a-zA-Z]\)|[a-zA-Z][\.\)])\s+(.*)$/);
                if (!match) {
                  return (
                    <li key={lineIndex} className="text-sm leading-relaxed">
                      {parseInline(line)}
                    </li>
                  );
                }
                return (
                  <li
                    key={lineIndex}
                    className="flex items-start gap-2 text-sm leading-relaxed text-slate-800 dark:text-slate-200"
                  >
                    <span className="shrink-0 select-none font-mono text-xs font-bold text-brand-700 dark:text-brand-300">
                      {match[1]}
                    </span>
                    <span className="flex-1 whitespace-pre-wrap">{parseInline(match[2])}</span>
                  </li>
                );
              })}
            </ol>
          );
        }

        // Bullet list block
        if (block.type === "bullet-list" && block.lines) {
          return (
            <ul key={blockIndex} className="my-2 space-y-1.5 pl-0.5">
              {block.lines.map((line, lineIndex) => {
                const match = line.trim().match(/^([-•*→·])\s+(.*)$/);
                if (!match) {
                  return (
                    <li key={lineIndex} className="text-sm leading-relaxed">
                      {parseInline(line)}
                    </li>
                  );
                }
                return (
                  <li
                    key={lineIndex}
                    className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-800 dark:text-slate-200"
                  >
                    <span className="shrink-0 select-none font-bold text-brand-600 dark:text-brand-400">
                      •
                    </span>
                    <span className="flex-1 whitespace-pre-wrap">{parseInline(match[2])}</span>
                  </li>
                );
              })}
            </ul>
          );
        }

        // Standard paragraph
        return (
          <p
            key={blockIndex}
            className="whitespace-pre-wrap leading-relaxed text-slate-800 dark:text-slate-100"
          >
            {parseInline(block.text || "")}
          </p>
        );
      })}
    </div>
  );
}
