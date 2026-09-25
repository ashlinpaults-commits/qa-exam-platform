"use client";

import Link from "next/link";
import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AuditorNav } from "@/components/layout/AuditorNav";
import { BookOpen, FileText, BarChart3, Users } from "lucide-react";

const CARDS = [
  { href: "/auditor/questions", label: "Question Bank", desc: "Browse, add, and import questions", icon: BookOpen },
  { href: "/auditor/exams", label: "Exams", desc: "Build, assign, and review exams", icon: FileText },
  { href: "/auditor/analytics", label: "Analytics", desc: "Performance across agents & modules", icon: BarChart3 },
  { href: "/auditor/admin", label: "Users", desc: "Promote agents to auditor", icon: Users },
];

export default function AuditorDashboardPage() {
  return (
    <RoleGate allow={["auditor"]}>
      <AppShell>
        <AuditorNav />
        <h1 className="mb-4 text-xl font-semibold">Auditor Dashboard</h1>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CARDS.map(({ href, label, desc, icon: Icon }) => (
            <Link key={href} href={href} className="card p-5 transition hover:shadow-card-hover">
              <Icon className="mb-2 h-5 w-5 text-brand-600" />
              <p className="font-medium">{label}</p>
              <p className="text-sm text-slate-500">{desc}</p>
            </Link>
          ))}
        </div>
      </AppShell>
    </RoleGate>
  );
}
