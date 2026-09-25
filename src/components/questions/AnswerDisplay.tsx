import type { Question } from "@/types";

export function AnswerDisplay({ question, agentAnswer }: { question: Question; agentAnswer: string }) {
  if (question.type === "mcq") {
    const idx = agentAnswer ? Number(agentAnswer) : null;
    const text = idx !== null ? question.options?.[idx] ?? "(no answer)" : "(no answer)";
    const isCorrect = idx === question.correctOptionIndex;
    return (
      <p className={isCorrect ? "text-green-600" : "text-red-600"}>
        {text} {question.correctOptionIndex !== undefined && (isCorrect ? "✓" : "✗")}
      </p>
    );
  }
  if (question.type === "drag_drop_order") {
    try {
      const items: string[] = agentAnswer ? JSON.parse(agentAnswer) : [];
      return (
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      );
    } catch {
      return <p className="text-sm">(malformed answer)</p>;
    }
  }
  return <p className="whitespace-pre-wrap text-sm">{agentAnswer || "(no answer)"}</p>;
}
