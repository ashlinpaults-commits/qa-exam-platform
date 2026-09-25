"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, BookOpen, FileText, BarChart3, Users } from "lucide-react";
import { clsx } from "clsx";

const LINKS = [
  { href: "/auditor/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/auditor/questions", label: "Question Bank", icon: BookOpen },
  { href: "/auditor/exams", label: "Exams", icon: FileText },
  { href: "/auditor/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/auditor/admin", label: "Users", icon: Users },
];

export function AuditorNav() {
  const pathname = usePathname();
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-slate-100 pb-3 dark:border-slate-800">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={clsx(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition",
              active ? "bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300" : "text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
            )}
          >
            <Icon className="h-4 w-4" /> {label}
          </Link>
        );
      })}
    </nav>
  );
}
