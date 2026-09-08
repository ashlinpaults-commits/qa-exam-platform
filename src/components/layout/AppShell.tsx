"use client";

import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { LogOut } from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const router = useRouter();

  return (
    <div className="min-h-screen bg-surface dark:bg-surface-dark">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/80 px-6 py-3 backdrop-blur dark:border-slate-800 dark:bg-surface-dark/80">
        <Link
          href="/"
          className="flex items-center gap-2.5 font-semibold transition-opacity hover:opacity-90"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white p-1 shadow-xs ring-1 ring-slate-200/70 dark:ring-white/15">
            <Image
              src="/logo-mark.png"
              alt="QA Exam Platform Logo"
              width={32}
              height={32}
              className="h-full w-full object-contain"
              priority
            />
          </div>
          <span className="text-base font-semibold tracking-tight text-slate-900 dark:text-white">
            QA Exam Platform
          </span>
        </Link>
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
