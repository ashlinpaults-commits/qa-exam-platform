import * as XLSX from "xlsx";
import type { Question, Exam, ExamAttempt, AppUser } from "@/types";

export function exportQuestionsToExcel(questions: Question[], filename = "questions_export.xlsx") {
  const rows = questions.map((q) => ({
    "Question ID": q.id,
    Module: q.module,
    Topic: q.feature,
    Difficulty: q.difficulty,
    Type: q.type,
    Question: q.questionText,
    "Expected Answer": q.expectedAnswer,
    Tags: q.tags.join(", "),
    Notes: q.notes ?? "",
    "Times Asked": q.stats.timesAsked,
    "Avg Marks": q.stats.avgMarks,
    "Correct %": q.stats.correctPct,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Questions");
  XLSX.writeFile(wb, filename);
}

export function exportAttemptsToExcel(
  attempts: ExamAttempt[],
  exam: Exam,
  usersById: Record<string, AppUser>,
  questionsById: Record<string, Question>,
  filename = "exam_results.xlsx"
) {
  const rows: Record<string, unknown>[] = [];
  attempts.forEach((a) => {
    a.answers.forEach((ans) => {
      rows.push({
        Exam: exam.name,
        Agent: usersById[a.agentId]?.name ?? a.agentId,
        Attempt: a.attemptNumber,
        Question: questionsById[ans.questionId]?.questionText ?? ans.questionId,
        "Agent Answer": ans.agentAnswer,
        "Expected Answer": questionsById[ans.questionId]?.expectedAnswer ?? "",
        Marks: ans.marks ?? "",
        "Max Marks": ans.maxMarks,
        Comments: ans.comments ?? "",
        "Submitted At": a.submittedAt ? new Date(a.submittedAt).toISOString() : "",
      });
    });
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Results");
  XLSX.writeFile(wb, filename);
}
