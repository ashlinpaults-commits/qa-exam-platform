"use client";

import { useState, useMemo } from "react";
import type { AppUser } from "@/types";
import { Search, Users, CheckSquare, Square, X, ArrowRight } from "lucide-react";

interface AgentSelectorModalProps {
  open: boolean;
  agents: AppUser[];
  onClose: () => void;
  onGenerate: (selectedAgentIds: string[]) => void;
  loading?: boolean;
}

export function AgentSelectorModal({
  open,
  agents,
  onClose,
  onGenerate,
  loading = false,
}: AgentSelectorModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filter only active eligible agents (role === "agent")
  const eligibleAgents = useMemo(() => {
    return agents
      .filter((u) => u.role === "agent")
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [agents]);

  // Filter by search query
  const filteredAgents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return eligibleAgents;
    return eligibleAgents.filter(
      (a) =>
        (a.name || "").toLowerCase().includes(q) ||
        (a.email || "").toLowerCase().includes(q)
    );
  }, [eligibleAgents, searchQuery]);

  // Toggle single agent
  function toggleAgent(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // Select all currently filtered agents
  function handleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredAgents.forEach((a) => next.add(a.uid));
      return next;
    });
  }

  // Clear all
  function handleClearAll() {
    setSelectedIds(new Set());
  }

  function handleGenerate() {
    if (selectedIds.size === 0) return;
    onGenerate(Array.from(selectedIds));
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden"
      >
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950/50 dark:text-brand-400">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Generate Agent Performance Report
              </h2>
              <p className="text-xs text-slate-500">
                Select one or multiple agents to generate individual performance reports.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* SEARCH & BULK ACTIONS */}
        <div className="border-b border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800/80 dark:bg-slate-800/30">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search agent by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10 pr-4 w-full"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600"
              >
                Clear
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSelectAll}
                className="font-medium text-brand-600 hover:underline dark:text-brand-400"
              >
                Select All ({filteredAgents.length})
              </button>
              <span className="text-slate-300 dark:text-slate-700">|</span>
              <button
                type="button"
                onClick={handleClearAll}
                disabled={selectedIds.size === 0}
                className="font-medium text-slate-500 hover:underline disabled:opacity-40"
              >
                Clear All
              </button>
            </div>

            <div className="font-semibold text-slate-700 dark:text-slate-300">
              <span className="text-brand-600 dark:text-brand-400">
                {selectedIds.size}
              </span>{" "}
              of {eligibleAgents.length} selected
            </div>
          </div>
        </div>

        {/* AGENT SELECTION LIST */}
        <div className="flex-1 overflow-y-auto p-4 divide-y divide-slate-100 dark:divide-slate-800">
          {filteredAgents.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              No matching agents found.
            </div>
          ) : (
            filteredAgents.map((agent) => {
              const isSelected = selectedIds.has(agent.uid);
              return (
                <label
                  key={agent.uid}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl p-3 transition hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                    isSelected ? "bg-brand-50/50 dark:bg-brand-950/20" : ""
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleAgent(agent.uid)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-800"
                    />

                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200 uppercase">
                      {agent.name ? agent.name.charAt(0) : "A"}
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {agent.name || "Unnamed Agent"}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {agent.email}
                      </p>
                    </div>
                  </div>

                  <span className="shrink-0 text-xs text-slate-400">
                    {isSelected ? (
                      <CheckSquare className="h-4 w-4 text-brand-600 dark:text-brand-400" />
                    ) : (
                      <Square className="h-4 w-4 text-slate-300 dark:text-slate-600" />
                    )}
                  </span>
                </label>
              );
            })
          )}
        </div>

        {/* FOOTER ACTIONS */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary text-sm"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleGenerate}
            disabled={selectedIds.size === 0 || loading}
            className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50"
          >
            <span>Generate Report ({selectedIds.size})</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
