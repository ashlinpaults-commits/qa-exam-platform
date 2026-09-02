"use client";

import { X } from "lucide-react";
import { ReactNode, useEffect } from "react";

export function Badge({
  children,
  color = "slate",
}: {
  children: ReactNode;
  color?: "slate" | "brand" | "green" | "amber" | "red" | "purple";
}) {
  const colors: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
    brand: "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300",
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    red: "bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    purple: "bg-purple-50 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className={`max-h-[90vh] w-full ${wide ? "max-w-3xl" : "max-w-md"} overflow-y-auto rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-800`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-1 p-12 text-center">
      <p className="font-medium">{title}</p>
      {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

export { MarkdownRenderer, MarkdownEditor } from "./MarkdownRenderer";

