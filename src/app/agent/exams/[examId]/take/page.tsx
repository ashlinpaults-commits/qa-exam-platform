"use client";

import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { TakeExam } from "@/components/exam-take/TakeExam";

export default function TakeExamPage({ params }: { params: { examId: string } }) {
  return (
    <RoleGate allow={["agent"]}>
      <AppShell>
        <TakeExam examId={params.examId} />
      </AppShell>
    </RoleGate>
  );
}
