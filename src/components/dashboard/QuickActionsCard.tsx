"use client";

import Link from "next/link";
import {
  FilePlus2,
  UserCheck,
  Upload,
  FileBarChart,
  Zap,
} from "lucide-react";

interface QuickActionsCardProps {
  onOpenReportGenerator: () => void;
}

export function QuickActionsCard({
  onOpenReportGenerator,
}: QuickActionsCardProps) {
  const actions = [
    {
      label: "Create Exam",
      desc: "New assessment",
      icon: FilePlus2,
      href: "/auditor/exams/create",
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950/50",
    },
    {
      label: "Assign Exam",
      desc: "Assign to trainees",
      icon: UserCheck,
      href: "/auditor/exams",
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/50",
    },
    {
      label: "Import Questions",
      desc: "Bulk CSV or JSON",
      icon: Upload,
      href: "/auditor/questions",
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-50 dark:bg-purple-950/50",
    },
    {
      label: "Generate Report",
      desc: "Agent scorecard",
      icon: FileBarChart,
      onClick: onOpenReportGenerator,
      color: "text-brand-600 dark:text-brand-400",
      bg: "bg-brand-50 dark:bg-brand-950/50",
    },
  ];

  return (
    <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-shadow hover:shadow-card-hover dark:border-slate-800 dark:bg-slate-900">
      <div>
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-slate-100 pb-4 dark:border-slate-800">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
            <Zap className="h-3.5 w-3.5" />
          </span>
          <div>
            <h2 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">
              Quick Actions
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Frequently used controls and operations
            </p>
          </div>
        </div>

        {/* Action Tiles Grid */}
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {actions.map((act) => {
            const Icon = act.icon;
            const content = (
              <div className="flex flex-col items-start rounded-xl border border-slate-200/70 bg-slate-50/50 p-3 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:shadow-xs active:scale-[0.98] dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-slate-700 dark:hover:bg-slate-800">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${act.bg} ${act.color} mb-2 shadow-xs`}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  {act.label}
                </span>
                <span className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                  {act.desc}
                </span>
              </div>
            );

            if (act.href) {
              return (
                <Link key={act.label} href={act.href} className="block">
                  {content}
                </Link>
              );
            }

            return (
              <button
                key={act.label}
                type="button"
                onClick={act.onClick}
                className="block w-full text-left"
              >
                {content}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100 text-[11px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
        Direct shortcuts to core auditor workflows
      </div>
    </div>
  );
}
