"use client";

import { useEffect, useState } from "react";
import { getQuestionVersions } from "@/lib/questions";
import type { Question, QuestionVersion } from "@/types";
import { Badge, MarkdownRenderer } from "@/components/ui/Primitives";
import {
  History,
  X,
  Loader2,
  Clock,
  ArrowRight,
  GitCompare,
} from "lucide-react";

interface Props {
  question: Question;
  onClose: () => void;
}

export function QuestionVersionHistoryModal({ question, onClose }: Props) {
  const [versions, setVersions] = useState<QuestionVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVersionId, setSelectedVersionId] = useState<string>("current");

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const data = await getQuestionVersions(question.id);
        setVersions(data);
      } catch (err) {
        console.error("Failed to load question history:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [question.id]);

  const selectedRevision =
    selectedVersionId === "current"
      ? null
      : versions.find((v) => v.id === selectedVersionId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="card flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-brand-600" />
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-white">
                Question Revision History
              </h3>
              <p className="text-xs text-slate-500">
                Inspect past revisions and track changes made to this question.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-16 text-slate-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading revision history...
          </div>
        ) : (
          <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[260px_1fr]">
            {/* Timeline Sidebar */}
            <div className="border-r border-slate-100 bg-slate-50/50 p-3 overflow-y-auto dark:border-slate-800 dark:bg-slate-900/30">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Revisions ({versions.length + 1})
              </p>

              <div className="space-y-1.5">
                {/* Current Live Version */}
                <button
                  type="button"
                  onClick={() => setSelectedVersionId("current")}
                  className={`w-full rounded-xl p-2.5 text-left text-xs transition ${
                    selectedVersionId === "current"
                      ? "bg-white font-medium text-brand-700 shadow-sm ring-1 ring-brand-500/20 dark:bg-slate-800 dark:text-brand-300"
                      : "text-slate-600 hover:bg-white/60 dark:text-slate-400 dark:hover:bg-slate-800/40"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">v{question.version || 1} (Current)</span>
                    <Badge color="green">Live</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(question.updatedAt || question.createdAt).toLocaleString()}
                  </p>
                </button>

                {/* Historical Revisions */}
                {versions.map((ver) => (
                  <button
                    key={ver.id}
                    type="button"
                    onClick={() => setSelectedVersionId(ver.id)}
                    className={`w-full rounded-xl p-2.5 text-left text-xs transition ${
                      selectedVersionId === ver.id
                        ? "bg-white font-medium text-brand-700 shadow-sm ring-1 ring-brand-500/20 dark:bg-slate-800 dark:text-brand-300"
                        : "text-slate-600 hover:bg-white/60 dark:text-slate-400 dark:hover:bg-slate-800/40"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">v{ver.version}</span>
                      <Badge color="slate">Archived</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(ver.updatedAt).toLocaleString()}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Revision Details / Diff */}
            <div className="flex-1 overflow-y-auto p-5">
              {selectedVersionId === "current" ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                      Current Live Version (v{question.version || 1})
                    </h4>
                    <span className="text-xs text-slate-400">
                      Last edited {new Date(question.updatedAt || question.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                    <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800">
                      <span className="text-slate-400">Module</span>
                      <p className="font-medium text-slate-800 dark:text-slate-200">{question.module}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800">
                      <span className="text-slate-400">Topic</span>
                      <p className="font-medium text-slate-800 dark:text-slate-200">{question.feature}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800">
                      <span className="text-slate-400">Difficulty</span>
                      <p className="font-medium capitalize text-slate-800 dark:text-slate-200">{question.difficulty}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800">
                      <span className="text-slate-400">Type</span>
                      <p className="font-medium capitalize text-slate-800 dark:text-slate-200">{question.type}</p>
                    </div>
                  </div>

                  <div>
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Question Text
                    </span>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 text-sm dark:border-slate-700 dark:bg-slate-800/40">
                      <MarkdownRenderer content={question.questionText} />
                    </div>
                  </div>

                  <div>
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Expected Answer / Rubric
                    </span>
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 text-sm text-emerald-950 dark:border-emerald-800/60 dark:bg-emerald-950/20 dark:text-emerald-200">
                      <MarkdownRenderer content={question.expectedAnswer} />
                    </div>
                  </div>

                  {question.options && question.options.length > 0 && (
                    <div>
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Options
                      </span>
                      <div className="space-y-1.5">
                        {question.options.map((opt, i) => (
                          <div
                            key={i}
                            className={`rounded-lg border px-3 py-1.5 text-xs ${
                              question.correctOptionIndex === i
                                ? "border-green-300 bg-green-50 font-medium text-green-900 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300"
                                : "border-slate-200 dark:border-slate-700"
                            }`}
                          >
                            {opt} {question.correctOptionIndex === i && "✓ (Correct)"}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : selectedRevision ? (
                <div className="space-y-5">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <GitCompare className="h-4 w-4 text-brand-600" />
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Comparing v{selectedRevision.version} with Current (v{question.version || 1})
                      </h4>
                    </div>
                    <span className="text-xs text-slate-400">
                      Snapshot from {new Date(selectedRevision.updatedAt).toLocaleString()}
                    </span>
                  </div>

                  {/* Question Text Diff */}
                  <div>
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Question Text Comparison
                    </span>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 text-xs dark:border-amber-800/40 dark:bg-amber-950/20">
                        <span className="mb-1 block font-bold text-amber-800 dark:text-amber-300">
                          v{selectedRevision.version} (Archived)
                        </span>
                        <div className="text-slate-700 dark:text-slate-300">
                          <MarkdownRenderer content={selectedRevision.questionText} />
                        </div>
                      </div>

                      <div className="rounded-xl border border-green-200 bg-green-50/40 p-3 text-xs dark:border-green-800/40 dark:bg-green-950/20">
                        <span className="mb-1 block font-bold text-green-800 dark:text-green-300">
                          v{question.version || 1} (Current Live)
                        </span>
                        <div className="text-slate-700 dark:text-slate-300">
                          <MarkdownRenderer content={question.questionText} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expected Answer Diff */}
                  <div>
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Expected Answer Comparison
                    </span>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800">
                        <span className="mb-1 block font-bold text-slate-600 dark:text-slate-400">
                          v{selectedRevision.version}
                        </span>
                        <div className="text-slate-700 dark:text-slate-300">
                          <MarkdownRenderer content={selectedRevision.expectedAnswer} />
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800">
                        <span className="mb-1 block font-bold text-slate-600 dark:text-slate-400">
                          Current Live
                        </span>
                        <div className="text-slate-700 dark:text-slate-300">
                          <MarkdownRenderer content={question.expectedAnswer} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Metadata diff */}
                  <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                    <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800">
                      <span className="text-slate-400">Module (v{selectedRevision.version})</span>
                      <p className="font-medium text-slate-800 dark:text-slate-200">{selectedRevision.module}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800">
                      <span className="text-slate-400">Topic (v{selectedRevision.version})</span>
                      <p className="font-medium text-slate-800 dark:text-slate-200">{selectedRevision.feature}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800">
                      <span className="text-slate-400">Difficulty</span>
                      <p className="font-medium capitalize text-slate-800 dark:text-slate-200">{selectedRevision.difficulty}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800">
                      <span className="text-slate-400">Type</span>
                      <p className="font-medium capitalize text-slate-800 dark:text-slate-200">{selectedRevision.type}</p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
