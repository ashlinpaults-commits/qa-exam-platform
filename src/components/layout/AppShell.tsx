"use client";

import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { ShieldCheck, LogOut } from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const router = useRouter();

  return (
    <div className="min-h-screen bg-surface dark:bg-surface-dark">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/80 px-6 py-3 backdrop-blur dark:border-slate-800 dark:bg-surface-dark/80">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-5 w-5 text-brand-600" />
          QA Exam Platform
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right text-sm">
            <p className="font-medium">{profile?.name}</p>
            <p className="capitalize text-slate-500">{profile?.role}</p>
          </div>
          <button
            className="btn-secondary"
            onClick={async () => {
              await signOut(auth);
              router.push("/login");
            }}
          >
            <LogOut className="mr-1 h-4 w-4" /> Sign out
          </button>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
