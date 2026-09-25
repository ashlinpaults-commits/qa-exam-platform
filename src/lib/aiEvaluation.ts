import type {
  Question,
  AiQuestionEvaluation,
  KnowledgeGapCategory,
  QuestionType,
} from "@/types";

export interface QuestionEvaluationInput {
  questionId: string;
  questionText: string;
  expectedAnswer: string;
  notes?: string;
  module: string;
  feature: string;
  type: QuestionType;
  agentAnswer: string;
  maxMarks: number;
  caseStudyContext?: string;
  imageUrl?: string;
  options?: string[];
  correctOptionIndex?: number;
  orderItems?: string[];
}

/**
 * Deterministically evaluates objectively scorable questions:
 * - MCQ
 * - True / False
 * - Drag and Drop Order
 * - Any question where the agent answer is blank / unanswered
 *
 * Returns null if the question requires qualitative / semantic AI evaluation.
 */
export function evaluateDeterministicAnswer(
  question: Pick<
    Question,
    | "id"
    | "type"
    | "options"
    | "correctOptionIndex"
    | "expectedAnswer"
    | "orderItems"
    | "module"
  >,
  agentAnswer: string,
  maxMarks = 10
): AiQuestionEvaluation | null {
  const trimmed = (agentAnswer || "").trim();

  // 1. Blank / unanswered questions are scored 0 deterministically
  if (!trimmed) {
    return {
      questionId: question.id,
      suggestedMarks: 0,
      maxMarks,
      keyPointsCovered: [],
      missingKeyPoints: ["Question was left blank / unanswered."],
      errors: ["No response submitted by agent."],
      reasoning: "The agent did not submit an answer for this question.",
      confidence: "high",
      suggestedComment: "No answer provided.",
      isDeterministic: true,
    };
  }

  // 2. Multiple Choice Questions
  if (question.type === "mcq") {
    const selectedIdx = Number(trimmed);
    const correctIdx = question.correctOptionIndex;
    const options = question.options ?? [];

    if (isNaN(selectedIdx) || selectedIdx < 0 || selectedIdx >= options.length) {
      return {
        questionId: question.id,
        suggestedMarks: 0,
        maxMarks,
        keyPointsCovered: [],
        missingKeyPoints: [
          correctIdx !== undefined && options[correctIdx]
            ? `Expected: "${options[correctIdx]}"`
            : "Valid option selection",
        ],
        errors: ["Invalid option index submitted."],
        reasoning: "Agent submitted an invalid or unparseable option choice.",
        confidence: "high",
        suggestedKnowledgeGap: "Product Knowledge",
        isDeterministic: true,
      };
    }

    if (correctIdx !== undefined && selectedIdx === correctIdx) {
      return {
        questionId: question.id,
        suggestedMarks: maxMarks,
        maxMarks,
        keyPointsCovered: [
          `Selected correct option (${selectedIdx + 1}): "${options[selectedIdx]}"`,
        ],
        missingKeyPoints: [],
        errors: [],
        reasoning: `Selected the correct multiple-choice option: "${options[selectedIdx]}".`,
        confidence: "high",
        suggestedComment: "Correct selection.",
        isDeterministic: true,
      };
    } else {
      const expectedText =
        correctIdx !== undefined && options[correctIdx]
          ? `"${options[correctIdx]}"`
          : "the correct option";
      const selectedText = options[selectedIdx]
        ? `"${options[selectedIdx]}"`
        : `Option ${selectedIdx + 1}`;

      return {
        questionId: question.id,
        suggestedMarks: 0,
        maxMarks,
        keyPointsCovered: [],
        missingKeyPoints: [`Expected correct option: ${expectedText}`],
        errors: [`Selected incorrect option: ${selectedText}`],
        reasoning: `Incorrect option selected (${selectedText}). Expected ${expectedText}.`,
        confidence: "high",
        suggestedComment: `Incorrect option selected. Correct answer was ${expectedText}.`,
        suggestedKnowledgeGap: "Product Knowledge",
        isDeterministic: true,
      };
    }
  }

  // 3. True / False Questions
  if (question.type === "true_false") {
    const normAgent = trimmed.toLowerCase();
    const normExpected = (question.expectedAnswer || "").trim().toLowerCase();

    if (normAgent === normExpected) {
      return {
        questionId: question.id,
        suggestedMarks: maxMarks,
        maxMarks,
        keyPointsCovered: [
          `Correctly identified the statement as ${question.expectedAnswer}.`,
        ],
        missingKeyPoints: [],
        errors: [],
        reasoning: `Correct answer (${question.expectedAnswer}).`,
        confidence: "high",
        suggestedComment: "Correct response.",
        isDeterministic: true,
      };
    } else {
      return {
        questionId: question.id,
        suggestedMarks: 0,
        maxMarks,
        keyPointsCovered: [],
        missingKeyPoints: [`Expected answer: ${question.expectedAnswer}`],
        errors: [`Selected: ${trimmed}`],
        reasoning: `Incorrect answer. The expected response was ${question.expectedAnswer}.`,
        confidence: "high",
        suggestedComment: `Incorrect. Expected answer was ${question.expectedAnswer}.`,
        suggestedKnowledgeGap: "Product Knowledge",
        isDeterministic: true,
      };
    }
  }

  // 4. Drag & Drop Ordering
  if (question.type === "drag_drop_order") {
    try {
      const items: string[] = JSON.parse(trimmed);
      const expectedItems = question.orderItems ?? [];

      if (!Array.isArray(items) || items.length === 0) {
        throw new Error("Invalid list");
      }

      // Check exact sequence
      const isExactMatch =
        items.length === expectedItems.length &&
        items.every((it, i) => it === expectedItems[i]);

      if (isExactMatch) {
        return {
          questionId: question.id,
          suggestedMarks: maxMarks,
          maxMarks,
          keyPointsCovered: [
            "All process steps arranged in the exact correct sequence.",
          ],
          missingKeyPoints: [],
          errors: [],
          reasoning: "Perfect step sequence matched.",
          confidence: "high",
          suggestedComment: "All steps ordered correctly.",
          isDeterministic: true,
        };
      }

      // Calculate partial ordering credit based on position matches
      let correctPositions = 0;
      const covered: string[] = [];
      const missing: string[] = [];

      expectedItems.forEach((expected, i) => {
        if (items[i] === expected) {
          correctPositions++;
          covered.push(`Step ${i + 1}: ${expected}`);
        } else {
          missing.push(
            `Step ${i + 1} should be "${expected}" (placed: "${items[i] ?? "none"}")`
          );
        }
      });

      const total = expectedItems.length || 1;
      const partialMarks = Math.round((correctPositions / total) * maxMarks);

      return {
        questionId: question.id,
        suggestedMarks: partialMarks,
        maxMarks,
        keyPointsCovered: covered,
        missingKeyPoints: missing,
        errors: ["Items placed out of correct operational sequence."],
        reasoning: `${correctPositions} of ${total} steps arranged in the correct sequence.`,
        confidence: "high",
        suggestedComment: `${correctPositions} of ${total} steps in correct order.`,
        suggestedKnowledgeGap: "Workflow",
        isDeterministic: true,
      };
    } catch {
      return {
        questionId: question.id,
        suggestedMarks: 0,
        maxMarks,
        keyPointsCovered: [],
        missingKeyPoints: ["Valid step sequence ordering"],
        errors: ["Malformed ordering data submitted."],
        reasoning: "Could not parse the agent order sequence.",
        confidence: "high",
        suggestedKnowledgeGap: "Workflow",
        isDeterministic: true,
      };
    }
  }

  // Not deterministic -> requires qualitative AI evaluation
  return null;
}

/**
 * Builds the structured prompt for qualitative evaluation of candidate answers.
 */
export function buildAiEvaluationPrompt(items: QuestionEvaluationInput[]): string {
  const formattedItems = items.map((item, index) => {
    let context = "";
    if (item.caseStudyContext) {
      context = `\nTICKET/CASE STUDY CONTEXT:\n${item.caseStudyContext}`;
    }
    if (item.notes) {
      context += `\nADDITIONAL NOTES / KEY POINTS:\n${item.notes}`;
    }
    if (item.imageUrl) {
      context += `\nIMAGE REFERENCE URL: ${item.imageUrl}`;
    }

    return `
--- QUESTION ${index + 1} ---
ID: ${item.questionId}
MODULE: ${item.module}
TOPIC / FEATURE: ${item.feature}
QUESTION TYPE: ${item.type}
QUESTION:
${item.questionText}${context}

EXPECTED ANSWER:
${item.expectedAnswer}

AGENT ACTUAL ANSWER:
${item.agentAnswer || "(No answer provided)"}

MAX MARKS: ${item.maxMarks}
`;
  }).join("\n");

  return `You are an expert QA exam auditor evaluating agent responses in a healthcare / software platform.
Your job is to evaluate each agent's answer against the expected answer and key points, assigning a suggested mark out of 10 and providing actionable feedback.

EVALUATION PRINCIPLES:
Evaluate answer QUALITY and UNDERSTANDING, NOT just binary correctness.
Do NOT use binary (Correct = 10, Wrong = 0).
Partial credit must be awarded when the agent demonstrates meaningful understanding, relevant knowledge, or valid steps, even if the final conclusion is imperfect.
Likewise, do NOT automatically give 10 simply because the answer reaches the right conclusion without the necessary steps or depth.

SCORING GUIDELINES (Marks out of 10):
- 10/10: Fully correct. Covers all important/key points, correct process/steps, no meaningful factual errors, complete enough to resolve the question.
- 8-9/10: Very strong answer. Mostly/all important points covered, minor omission or wording issue, no significant conceptual error.
- 6-7/10: Generally correct. Covers several important points, some key information missing, minor misunderstanding or incomplete process.
- 4-5/10: Partially correct. Some relevant understanding demonstrated, multiple important key points missing, may contain some incorrect information.
- 2-3/10: Limited understanding. Only a small portion of expected answer is correct, major key points missing, significant inaccuracies.
- 1/10: Very minimal relevant information. Barely demonstrates understanding, mostly incorrect or incomplete.
- 0/10: Completely incorrect, irrelevant, or blank.

KNOWLEDGE GAP CATEGORIES (if suggestedMarks < 10, choose the best fit):
"Product Knowledge", "Workflow", "Navigation", "Troubleshooting", "Insurance", "Reporting", "Clinical", "Scheduler", "Communication", "Compliance", "Other"

CRITICAL INSTRUCTIONS:
1. Do not invent key points that contradict the expected answer.
2. If question data lacks sufficient detail for high confidence, set confidence to "medium" or "low" and explain in reasoning.
3. Return ONLY a single valid JSON object containing an "evaluations" array. No other markdown or commentary.

SCHEMA:
{
  "evaluations": [
    {
      "questionId": "string (matches input ID)",
      "suggestedMarks": number (integer between 0 and 10),
      "maxMarks": 10,
      "keyPointsCovered": ["string (points correctly covered by agent)"],
      "missingKeyPoints": ["string (expected points omitted or incomplete)"],
      "errors": ["string (factual or process mistakes in agent answer, if any)"],
      "reasoning": "string (concise 1-3 sentences explaining why this mark was assigned)",
      "confidence": "high" | "medium" | "low",
      "suggestedComment": "string (constructive auditor feedback for the agent)",
      "suggestedKnowledgeGap": "string (one of the valid categories, only if marks < 10)"
    }
  ]
}

QUESTIONS TO EVALUATE:
${formattedItems}
`;
}

/**
 * Parses and validates the AI model JSON response.
 * Safely handles markdown wrapping, malformed JSON, and clamps scores.
 */
export function parseAiEvaluationResponse(
  rawText: string,
  items: QuestionEvaluationInput[]
): Record<string, AiQuestionEvaluation> {
  const result: Record<string, AiQuestionEvaluation> = {};

  try {
    // Strip markdown fences if present
    let cleaned = rawText.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, "");
      cleaned = cleaned.replace(/\s*```$/i, "");
    }
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);
    const list: Partial<AiQuestionEvaluation>[] = Array.isArray(parsed?.evaluations)
      ? parsed.evaluations
      : Array.isArray(parsed)
      ? parsed
      : [];

    list.forEach((entry) => {
      if (!entry || !entry.questionId) return;

      const matchingItem = items.find((i) => i.questionId === entry.questionId);
      const maxMarks = matchingItem?.maxMarks ?? entry.maxMarks ?? 10;

      let marks = Number(entry.suggestedMarks ?? 0);
      if (isNaN(marks)) marks = 0;
      marks = Math.max(0, Math.min(maxMarks, Math.round(marks)));

      const validConfidence =
        entry.confidence === "high" ||
        entry.confidence === "medium" ||
        entry.confidence === "low"
          ? entry.confidence
          : "medium";

      result[entry.questionId] = {
        questionId: entry.questionId,
        suggestedMarks: marks,
        maxMarks,
        keyPointsCovered: Array.isArray(entry.keyPointsCovered)
          ? entry.keyPointsCovered.map(String)
          : [],
        missingKeyPoints: Array.isArray(entry.missingKeyPoints)
          ? entry.missingKeyPoints.map(String)
          : [],
        errors: Array.isArray(entry.errors) ? entry.errors.map(String) : [],
        reasoning: String(entry.reasoning || "Evaluation completed.").trim(),
        confidence: validConfidence,
        suggestedComment: entry.suggestedComment
          ? String(entry.suggestedComment).trim()
          : undefined,
        suggestedKnowledgeGap: (entry.suggestedKnowledgeGap as KnowledgeGapCategory) || undefined,
        isDeterministic: false,
      };
    });
  } catch (err) {
    console.warn("Failed to parse AI evaluation JSON response:", err);
  }

  // Ensure every item has an evaluation; if any were omitted by model, use fallback
  items.forEach((item) => {
    if (!result[item.questionId]) {
      result[item.questionId] = evaluateFallbackSemanticAnswer(
        item,
        "AI response could not be parsed for this question. Heuristic fallback applied."
      );
    }
  });

  return result;
}

/**
 * Intelligent heuristic fallback evaluator used when AI API is unavailable,
 * unconfigured, or returns an incomplete response.
 *
 * Evaluates semantic answers by analyzing key concept overlap between
 * the expected answer and the agent's answer.
 */
export function evaluateFallbackSemanticAnswer(
  item: QuestionEvaluationInput,
  fallbackNotice?: string
): AiQuestionEvaluation {
  const expected = (item.expectedAnswer || "").trim();
  const actual = (item.agentAnswer || "").trim();
  const maxMarks = item.maxMarks || 10;

  if (!actual) {
    return {
      questionId: item.questionId,
      suggestedMarks: 0,
      maxMarks,
      keyPointsCovered: [],
      missingKeyPoints: ["Question was left blank."],
      errors: ["No response provided."],
      reasoning: "The agent did not submit an answer.",
      confidence: "high",
      suggestedComment: "No answer provided.",
      isDeterministic: true,
    };
  }

  // Extract key concept sentences / phrases from expected answer
  const rawSentences = expected
    .split(/[.;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  const sentences =
    rawSentences.length > 0 ? rawSentences : [expected];

  const actualLower = actual.toLowerCase();
  const covered: string[] = [];
  const missing: string[] = [];

  sentences.forEach((sentence) => {
    // Extract significant keywords (>3 chars, non-stopword)
    const words = sentence
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 3 &&
          !["with", "from", "that", "this", "they", "have", "been", "will", "what", "when", "where", "which", "your", "should"].includes(
            w
          )
      );

    if (words.length === 0) return;

    const matchedWords = words.filter((w) => actualLower.includes(w));
    const matchRatio = matchedWords.length / words.length;

    if (matchRatio >= 0.5) {
      covered.push(sentence);
    } else {
      missing.push(sentence);
    }
  });

  const totalPoints = sentences.length || 1;
  const coverageRatio = covered.length / totalPoints;

  // Quality heuristic:
  // 100% coverage + reasonable length -> 9-10
  // 70-99% -> 7-8
  // 40-69% -> 5-6
  // 10-39% -> 3-4
  // <10% -> 1-2
  let score = Math.round(coverageRatio * maxMarks);
  if (coverageRatio >= 0.9 && actual.length >= 25) {
    score = Math.min(maxMarks, Math.max(9, score));
  } else if (coverageRatio < 0.2 && actual.length > 0) {
    score = Math.max(1, Math.min(3, score));
  }

  const defaultKnowledgeGap = inferKnowledgeGapFromModule(item.module);

  return {
    questionId: item.questionId,
    suggestedMarks: score,
    maxMarks,
    keyPointsCovered:
      covered.length > 0
        ? covered.slice(0, 4)
        : ["Partial context provided in response."],
    missingKeyPoints:
      missing.length > 0
        ? missing.slice(0, 4)
        : ["Verify full operational details from expected answer."],
    errors:
      score < 5
        ? ["Significant key points from the expected answer appear to be missing."]
        : [],
    reasoning:
      fallbackNotice ??
      `Covers approximately ${Math.round(coverageRatio * 100)}% of expected key concept points. (Heuristic evaluation; auditor review recommended).`,
    confidence: "low",
    suggestedComment:
      score >= 8
        ? "Good response covering key requirements."
        : score >= 5
        ? "Partially correct. Review missing key steps."
        : "Incomplete answer. Significant key details are missing.",
    suggestedKnowledgeGap: score < maxMarks ? defaultKnowledgeGap : undefined,
    isDeterministic: false,
  };
}

function inferKnowledgeGapFromModule(moduleName?: string): KnowledgeGapCategory {
  const norm = (moduleName || "").toLowerCase();
  if (norm.includes("schedul")) return "Scheduler";
  if (norm.includes("clinic") || norm.includes("patient")) return "Clinical";
  if (norm.includes("insuran") || norm.includes("rcm") || norm.includes("billing")) return "Insurance";
  if (norm.includes("report")) return "Reporting";
  if (norm.includes("navigat")) return "Navigation";
  if (norm.includes("troubleshoot")) return "Troubleshooting";
  if (norm.includes("complian")) return "Compliance";
  if (norm.includes("workflow")) return "Workflow";
  return "Product Knowledge";
}
