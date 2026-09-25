"use client";

import { RoleGate } from "@/components/auth/RoleGate";
import { AppShell } from "@/components/layout/AppShell";
import { AuditorNav } from "@/components/layout/AuditorNav";
import { ExamBuilder } from "@/components/exam-builder/ExamBuilder";
import Link from "next/link";

export default function EditExamPage({
  params,
}: {
  params: {
    examId: string;
  };
}) {
  return (
    <RoleGate allow={["auditor"]}>
      <AppShell>
        <AuditorNav />

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">
            Edit Exam
          </h1>

          <div className="flex flex-wrap gap-2">
            <Link
              href={`/auditor/exams/${params.examId}/results`}
              className="btn-secondary"
            >
              View Results
            </Link>

            <Link
              href={`/auditor/exams/${params.examId}/review`}
              className="btn-secondary"
            >
              Review Attempts
            </Link>
          </div>
        </div>

        <ExamBuilder examId={params.examId} />
      </AppShell>
    </RoleGate>
  );
}
