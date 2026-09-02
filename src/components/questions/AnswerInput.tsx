"use client";

import { useState } from "react";
import type { Question } from "@/types";
import { MarkdownRenderer, Badge } from "@/components/ui/Primitives";
import {
  Link as LinkIcon,
  Video,
  Play,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  ExternalLink,
  Film,
} from "lucide-react";

const ALLOWED_DOMAINS = [
  "loom.com",
  "www.loom.com",
  "screencast.com",
  "www.screencast.com",
  "techsmith.com",
  "drive.google.com",
  "youtube.com",
  "www.youtube.com",
  "youtu.be",
  "vimeo.com",
  "dropbox.com",
  "sharepoint.com",
  "1drv.ms",
  "onedrive.live.com",
];

function isAllowedDomain(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    const isKnownDomain = ALLOWED_DOMAINS.some((d) => host === d || host.endsWith("." + d));
    const isDirectVideo =
      parsed.pathname.endsWith(".mp4") ||
      parsed.pathname.endsWith(".webm") ||
      parsed.pathname.endsWith(".mov");
    return isKnownDomain || isDirectVideo;
  } catch {
    return false;
  }
}

export interface ScreenRecordingPayload {
  recordingUrl: string;
  source: "external_link";
  uploadedAt: number;
  candidateNotes?: string;
}

function ScreenRecordingAnswerInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string;
  onChange: (v: string) => void;
  examId?: string;
  attemptId?: string;
}) {
  let parsedPayload: ScreenRecordingPayload | null = null;
  if (value) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && parsed.recordingUrl) {
        parsedPayload = parsed;
      }
    } catch {
      if (value.startsWith("http://") || value.startsWith("https://")) {
        parsedPayload = {
          recordingUrl: value,
          source: "external_link",
          uploadedAt: Date.now(),
        };
      }
    }
  }

  const [linkInput, setLinkInput] = useState(parsedPayload?.recordingUrl ?? "");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [notes, setNotes] = useState(parsedPayload?.candidateNotes ?? "");

  function handleSaveLink() {
    setLinkError(null);
    const trimmed = linkInput.trim();
    if (!trimmed) {
      setLinkError("Please enter a valid video link.");
      return;
    }

    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      setLinkError("Please include https:// in the link.");
      return;
    }

    if (!isAllowedDomain(trimmed)) {
      setLinkError(
        "Domain not recognized. Allowed services: Loom, Screencast.com, TechSmith Snagit Cloud, Google Drive, YouTube, Vimeo, OneDrive, Dropbox, or direct video URLs."
      );
      return;
    }

    const payload: ScreenRecordingPayload = {
      recordingUrl: trimmed,
      source: "external_link",
      uploadedAt: Date.now(),
      candidateNotes: notes,
    };

    onChange(JSON.stringify(payload));
  }

  function handleRemove() {
    onChange("");
    setLinkInput("");
    setLinkError(null);
  }

  function handleNotesChange(newNotes: string) {
    setNotes(newNotes);
    if (parsedPayload) {
      onChange(JSON.stringify({ ...parsedPayload, candidateNotes: newNotes }));
    } else if (newNotes.trim()) {
      onChange(
        JSON.stringify({
          recordingUrl: "",
          source: "external_link",
          uploadedAt: Date.now(),
          candidateNotes: newNotes,
        })
      );
    }
  }

  const isLoom =
    parsedPayload?.recordingUrl.includes("loom.com/share/") ||
    parsedPayload?.recordingUrl.includes("loom.com/embed/");
  const isDirectVideo =
    parsedPayload?.recordingUrl.endsWith(".mp4") ||
    parsedPayload?.recordingUrl.endsWith(".webm") ||
    parsedPayload?.recordingUrl.endsWith(".mov");

  return (
    <div className="space-y-4">
      {/* If recording is saved, show preview & metadata */}
      {parsedPayload?.recordingUrl ? (
        <div className="space-y-3 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-900/50 dark:bg-indigo-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 pb-3 dark:border-indigo-900/30">
            <div className="flex items-center gap-2">
              <Film className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  Recording Attached
                </p>
                <p className="text-xs text-slate-500">
                  External Workflow Recording Link
                </p>
              </div>
            </div>

            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 shadow-sm transition hover:bg-red-50 dark:border-red-900/40 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/30"
              onClick={handleRemove}
            >
              <Trash2 className="h-3.5 w-3.5" /> Replace / Edit Link
            </button>
          </div>

          {/* Video Player or Embedded Frame */}
          {isDirectVideo ? (
            <div className="overflow-hidden rounded-xl bg-black">
              <video
                controls
                className="max-h-80 w-full"
                src={parsedPayload.recordingUrl}
                preload="metadata"
              >
                Your browser does not support HTML5 video.
              </video>
            </div>
          ) : isLoom ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-200 bg-black">
              <iframe
                src={parsedPayload.recordingUrl.replace("loom.com/share/", "loom.com/embed/")}
                className="h-full w-full"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
              <div className="min-w-0 flex-1 truncate font-mono text-slate-600 dark:text-slate-300">
                {parsedPayload.recordingUrl}
              </div>
              <a
                href={parsedPayload.recordingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary ml-3 flex shrink-0 items-center gap-1 text-xs"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Open Link
              </a>
            </div>
          )}

          {/* Candidate Notes */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Accompanying Notes / Commentary (Optional)
            </label>
            <textarea
              className="input text-xs"
              rows={2}
              placeholder="Add any additional workflow steps, ticket numbers, or explanations..."
              value={notes}
              onChange={(e) => handleNotesChange(e.target.value)}
            />
          </div>
        </div>
      ) : (
        /* Link Input Controls */
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <Video className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                Workflow Screen Recording Link
              </span>
            </div>
          </div>

          {linkError && (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{linkError}</span>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
                External Video Link
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  className="input text-xs"
                  placeholder="https://www.loom.com/share/... or https://www.screencast.com/... or Google Drive link"
                  value={linkInput}
                  onChange={(e) => setLinkInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSaveLink();
                    }
                  }}
                />
                <button
                  type="button"
                  className="btn-primary shrink-0 text-xs"
                  onClick={handleSaveLink}
                >
                  Attach Link
                </button>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Supported services: Loom, Screencast.com, TechSmith Snagit Cloud, Google Drive, YouTube, Vimeo, OneDrive, Dropbox, or direct video links.
            </p>
          </div>

          {/* Optional notes input before saving link */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Accompanying Notes / Commentary (Optional)
            </label>
            <textarea
              className="input text-xs"
              rows={2}
              placeholder="Add any additional workflow steps, ticket numbers, or explanations..."
              value={notes}
              onChange={(e) => handleNotesChange(e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Renders the correct input control for each of the 7 question types when an
// agent is taking an exam. Always stores answer as a string (JSON-encoded for
// structured types like mcq/drag-order/screen_recording) so AttemptAnswer.agentAnswer stays uniform.
export function AnswerInput({
  question,
  value,
  onChange,
  examId,
  attemptId,
}: {
  question: Question;
  value: string;
  onChange: (v: string) => void;
  examId?: string;
  attemptId?: string;
}) {
  switch (question.type) {
    case "screen_recording":
      return (
        <ScreenRecordingAnswerInput
          question={question}
          value={value}
          onChange={onChange}
          examId={examId}
          attemptId={attemptId}
        />
      );
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
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm dark:border-slate-700 dark:bg-slate-800">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Ticket / Case Context
              </p>
              <MarkdownRenderer content={question.caseStudyContext} />
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

