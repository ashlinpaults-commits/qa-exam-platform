"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import type { UserRole } from "@/types";
import { Loader2, ShieldAlert } from "lucide-react";

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
    if (profile && !profile.deactivated && !allow.includes(profile.role)) {
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

  if (profile.deactivated) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6 bg-surface dark:bg-surface-dark">
        <div className="card max-w-md p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold">Account Deactivated</h2>
          <p className="mt-2 text-sm text-slate-500">
            Your account has been deactivated by an administrator. Please contact an auditor if you believe this is in error.
          </p>
          <button
            className="btn-secondary mt-6"
            onClick={async () => {
              await signOut(auth);
              router.push("/login");
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  if (!allow.includes(profile.role)) return null;

  return <>{children}</>;
}
