"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import type { UserRole } from "@/types";
import { Loader2 } from "lucide-react";

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

  if (!allow.includes(profile.role)) return null;

  return <>{children}</>;
}
