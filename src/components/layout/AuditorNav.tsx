"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, BookOpen, FileText, BarChart3, Users } from "lucide-react";
import { clsx } from "clsx";

import React from "react";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hasNotification?: boolean;
}

const LINKS: NavItem[] = [
  { href: "/auditor/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/auditor/questions", label: "Question Bank", icon: BookOpen },
  { href: "/auditor/exams", label: "Exams", icon: FileText },
  { href: "/auditor/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/auditor/admin", label: "Users", icon: Users },
];

function isRouteActive(currentPath: string, targetHref: string): boolean {
  if (targetHref === "/auditor/analytics") {
    return currentPath.startsWith("/auditor/analytics") || currentPath.startsWith("/auditor/reports");
  }
  return currentPath.startsWith(targetHref);
}

export function AuditorNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Auditor Navigation"
      className="relative mb-6 w-full border-b border-slate-200/80 dark:border-slate-800"
    >
      <div className="flex items-center gap-1 sm:gap-2 md:gap-3 lg:gap-4 overflow-x-auto scrollbar-none scroll-smooth -mb-px px-0.5">
        {LINKS.map(({ href, label, icon: Icon, hasNotification }) => {
          const active = isRouteActive(pathname, href);

          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "group relative inline-flex items-center gap-2.5 rounded-t-xl px-3.5 py-2.5 sm:px-4 sm:py-3 text-sm font-medium tracking-tight whitespace-nowrap select-none",
                "transition-all duration-200 ease-out outline-none motion-reduce:transition-none",
                "focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
                active
                  ? "bg-brand-50/70 text-brand-700 dark:bg-brand-950/25 dark:text-brand-300 font-semibold"
                  : "text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/50 dark:hover:text-slate-100"
              )}
            >
              {/* Icon with active brand color and subtle hover darkening */}
              <Icon
                className={clsx(
                  "h-4 w-4 shrink-0 transition-colors duration-200 motion-reduce:transition-none",
                  active
                    ? "text-brand-600 dark:text-brand-400"
                    : "text-slate-400 group-hover:text-slate-700 dark:text-slate-500 dark:group-hover:text-slate-200"
                )}
              />

              {/* Tab Title */}
              <span>{label}</span>

              {/* Optional Notification Dot Indicator */}
              {hasNotification && (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-brand-500 ring-2 ring-white dark:ring-slate-900"
                  aria-hidden="true"
                />
              )}

              {/* Elegant Underline: ~4px (h-1), rounded pill ends, red brand accent */}
              {active && (
                <span
                  className="absolute bottom-0 left-2 right-2 h-1 rounded-full bg-brand-600 dark:bg-brand-500 shadow-xs shadow-brand-500/25 transition-all duration-200 ease-out motion-reduce:transition-none"
                  aria-hidden="true"
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
