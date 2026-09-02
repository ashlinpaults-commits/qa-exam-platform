import type { Question } from "@/types";
import { Film, ExternalLink } from "lucide-react";

export function AnswerDisplay({ question, agentAnswer }: { question: Question; agentAnswer: string }) {
  if (question.type === "screen_recording") {
    let recordingUrl = "";
    let source: "upload" | "external_link" = "upload";
    let fileSize: number | undefined;
    let duration: number | undefined;
    let candidateNotes = "";

    if (agentAnswer) {
      try {
        const parsed = JSON.parse(agentAnswer);
        if (parsed && typeof parsed === "object") {
          recordingUrl = parsed.recordingUrl || "";
          source = parsed.source || "upload";
          fileSize = parsed.fileSize;
          duration = parsed.duration;
          candidateNotes = parsed.candidateNotes || "";
        }
      } catch {
        if (agentAnswer.startsWith("http://") || agentAnswer.startsWith("https://")) {
          recordingUrl = agentAnswer;
          source = "external_link";
        } else {
          candidateNotes = agentAnswer;
        }
      }
    }

    if (!recordingUrl && !candidateNotes) {
      return <p className="italic text-slate-400 text-sm">(No recording provided)</p>;
    }

    const isLoom = recordingUrl.includes("loom.com/share/") || recordingUrl.includes("loom.com/embed/");
    const loomEmbedUrl = isLoom ? recordingUrl.replace("loom.com/share/", "loom.com/embed/") : "";
    const isDirectVideo =
      recordingUrl.endsWith(".mp4") ||
      recordingUrl.endsWith(".webm") ||
      recordingUrl.endsWith(".mov");

    return (
      <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2.5 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <Film className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Workflow Screen Recording
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              External Link
            </span>
            {fileSize && (
              <span>· {(fileSize / (1024 * 1024)).toFixed(1)} MB</span>
            )}
            {duration && (
              <span>· {Math.floor(duration / 60)}m {duration % 60}s</span>
            )}
          </div>
        </div>

        {recordingUrl && (
          isDirectVideo ? (
            <div className="overflow-hidden rounded-xl bg-black">
              <video
                controls
                className="max-h-96 w-full"
                src={recordingUrl}
                preload="metadata"
              >
                Your browser does not support video playback.
              </video>
            </div>
          ) : isLoom ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-slate-200 bg-black">
              <iframe
                src={loomEmbedUrl}
                className="h-full w-full"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
              <div className="min-w-0 flex-1 truncate font-mono text-slate-600 dark:text-slate-300">
                {recordingUrl}
              </div>
              <a
                href={recordingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary ml-3 flex shrink-0 items-center gap-1 text-xs"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Watch Recording
              </a>
            </div>
          )
        )}

        {candidateNotes && (
          <div className="rounded-lg bg-white p-3 text-xs dark:bg-slate-800">
            <p className="mb-1 font-semibold text-slate-500">Agent Notes / Steps:</p>
            <p className="whitespace-pre-wrap text-slate-700 dark:text-slate-200">{candidateNotes}</p>
          </div>
        )}
      </div>
    );
  }

  if (question.type === "mcq") {
    const idx = agentAnswer ? Number(agentAnswer) : null;
    const text = idx !== null ? question.options?.[idx] ?? "(no answer)" : "(no answer)";
    const isCorrect = idx === question.correctOptionIndex;
    return (
      <p className={isCorrect ? "text-green-600" : "text-red-600"}>
        {text} {question.correctOptionIndex !== undefined && (isCorrect ? "✓" : "✗")}
      </p>
    );
  }
  if (question.type === "drag_drop_order") {
    try {
      const items: string[] = agentAnswer ? JSON.parse(agentAnswer) : [];
      return (
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      );
    } catch {
      return <p className="text-sm">(malformed answer)</p>;
    }
  }
  return <p className="whitespace-pre-wrap text-sm">{agentAnswer || "(no answer)"}</p>;
}
