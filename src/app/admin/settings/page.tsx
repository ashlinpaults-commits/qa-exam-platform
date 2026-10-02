"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RoleGate } from "@/components/auth/RoleGate";
import { Loader2 } from "lucide-react";

function AdminSettingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/auditor/settings");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
    </div>
  );
}

export default function AdminSettingsPage() {
  return (
    <RoleGate allow={["auditor"]}>
      <AdminSettingsRedirect />
    </RoleGate>
  );
}
