"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import type { UserRole } from "@/types";
import { Loader2, XCircle } from "lucide-react";
import { auth } from "@/lib/firebase";

export function RoleGate({
  allow,
  children,
}: {
  allow: UserRole[];
  children: React.ReactNode;
}) {
  const { profile, loading, firebaseUser } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      router.replace("/login");
      return;
    }
    if (profile && !allow.includes(profile.role)) {
      router.replace(profile.role === "auditor" ? "/auditor/dashboard" : "/agent/dashboard");
    }
  }, [loading, firebaseUser, profile, allow, router]);

  if (loading || !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
      </div>
    );
  }

  if (profile.isActive === false || profile.status === "inactive") {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 text-center bg-surface dark:bg-surface-dark">
        <div className="max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900 shadow-md dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400">
            <XCircle className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-bold">Account Deactivated</h2>
          <p className="mt-2 text-sm text-red-800 dark:text-red-300">
            Your account has been deactivated by an administrator. Please contact your QA auditor or manager for assistance.
          </p>
          <div className="mt-5">
            <button
              type="button"
              className="btn-secondary text-xs px-4 py-2"
              onClick={async () => {
                await auth.signOut();
                window.location.href = "/login";
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!allow.includes(profile.role)) return null;

  return <>{children}</>;
}
