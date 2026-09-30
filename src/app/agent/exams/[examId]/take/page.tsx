"use client";

import { Suspense } from "react";
import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { TakeExam } from "@/components/exam-take/TakeExam";
import { Loader2 } from "lucide-react";

export default function TakeExamPage({ params }: { params: { examId: string } }) {
  return (
    <RoleGate allow={["agent"]}>
      <AppShell>
        <Suspense
          fallback={
            <div className="flex min-h-[50vh] items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-brand-600" />
            </div>
          }
        >
          <TakeExam examId={params.examId} />
        </Suspense>
      </AppShell>
    </RoleGate>
  );
}
