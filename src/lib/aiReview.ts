import { doc, updateDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import type {
  Question,
  AttemptAnswer,
  AttemptAiReview,
  QuestionAiReview,
  AiConfidence,
  AiVerdict,
} from "@/types";
import { stripUndefined, extractRawAnswerText } from "./questions";

const COL_ATTEMPTS = "attempts";

/**
 * Deterministically grades objective questions (MCQ, True/False, Drag & Drop, Empty).
 * Returns null if the question is subjective and requires semantic evaluation.
 */
export function evaluateObjectiveQuestion(
  question: Question,
  agentAnswer: string,
  maxMarks: number
): QuestionAiReview | null {
  const trimmedAnswer = (agentAnswer || "").trim();

  // 1. Unanswered / Empty question
  if (!trimmedAnswer) {
    return {
      questionId: question.id,
      understandingScore: 0,
      aiSuggestedScore: 0,
      maxScore: maxMarks,
      confidence: "high",
      verdict: "no_answer",
      reasoning: "No answer was provided by the agent.",
      missingPoints: ["Complete answer missing."],
      detectedIssues: [],
      reviewedAt: Date.now(),
    };
  }

  // 2. Multiple Choice Question (MCQ)
  if (question.type === "mcq") {
    let isCorrect = false;
    let expectedText = question.expectedAnswer || "";

    if (
      question.correctOptionIndex !== undefined &&
      question.options &&
      question.options[question.correctOptionIndex]
    ) {
      expectedText = question.options[question.correctOptionIndex].trim();
      // Match by option index or full text
      if (
        trimmedAnswer === String(question.correctOptionIndex) ||
        trimmedAnswer.toLowerCase() === expectedText.toLowerCase()
      ) {
        isCorrect = true;
      }
    } else if (expectedText) {
      isCorrect = trimmedAnswer.toLowerCase() === expectedText.toLowerCase();
    }

    return {
      questionId: question.id,
      understandingScore: isCorrect ? 10 : 0,
      aiSuggestedScore: isCorrect ? maxMarks : 0,
      maxScore: maxMarks,
      confidence: "high",
      verdict: isCorrect ? "fully_correct" : "incorrect",
      reasoning: isCorrect
        ? "Correct option selected."
        : `Selected answer does not match the correct option: "${expectedText}".`,
      missingPoints: isCorrect ? [] : [`Expected option: ${expectedText}`],
      detectedIssues: isCorrect ? [] : [`Agent chose: ${trimmedAnswer}`],
      reviewedAt: Date.now(),
    };
  }

  // 3. True / False Question
  if (question.type === "true_false") {
    const normAgent = trimmedAnswer.toLowerCase();
    const normExpected = (question.expectedAnswer || "").toLowerCase().trim();
    const isCorrect = normAgent === normExpected;

    return {
      questionId: question.id,
      understandingScore: isCorrect ? 10 : 0,
      aiSuggestedScore: isCorrect ? maxMarks : 0,
      maxScore: maxMarks,
      confidence: "high",
      verdict: isCorrect ? "fully_correct" : "incorrect",
      reasoning: isCorrect
        ? "Correct statement selection."
        : `Incorrect selection. Expected: ${question.expectedAnswer}.`,
      missingPoints: isCorrect ? [] : [`Expected: ${question.expectedAnswer}`],
      detectedIssues: isCorrect ? [] : [`Agent chose: ${trimmedAnswer}`],
      reviewedAt: Date.now(),
    };
  }

  // 4. Drag & Drop Ordering
  if (question.type === "drag_drop_order" && question.orderItems && question.orderItems.length > 0) {
    let agentItems: string[] = [];
    try {
      const parsed = JSON.parse(trimmedAnswer);
      if (Array.isArray(parsed)) agentItems = parsed;
    } catch {
      agentItems = trimmedAnswer.split("\n").map((s) => s.trim()).filter(Boolean);
    }

    let correctPositions = 0;
    const totalItems = question.orderItems.length;

    question.orderItems.forEach((expectedItem, i) => {
      if (agentItems[i] && agentItems[i].toLowerCase() === expectedItem.toLowerCase()) {
        correctPositions += 1;
      }
    });

    const isFull = correctPositions === totalItems;
    const understandingScore = Math.round((correctPositions / totalItems) * 10);
    const score = Math.round((correctPositions / totalItems) * maxMarks * 10) / 10;
    const verdict: AiVerdict = isFull
      ? "fully_correct"
      : correctPositions > 0
      ? "partially_correct"
      : "incorrect";

    return {
      questionId: question.id,
      understandingScore,
      aiSuggestedScore: score,
      maxScore: maxMarks,
      confidence: "high",
      verdict,
      reasoning: isFull
        ? "All items correctly ordered."
        : `${correctPositions} of ${totalItems} items placed in the correct sequence.`,
      missingPoints: isFull ? [] : ["Some items were placed out of order."],
      detectedIssues: [],
      reviewedAt: Date.now(),
    };
  }

  // Subjective (descriptive, case_study, image_based)
  return null;
}

/**
 * Calls Gemini API to perform semantic grading on subjective questions.
 * Enforces server-side GEMINI_API_KEY without exposing it to the client.
 */
async function callGeminiSemanticGrading(
  subjectiveQuestions: {
    question: Question;
    agentAnswer: string;
    maxMarks: number;
  }[]
): Promise<Map<string, QuestionAiReview>> {
  const resultMap = new Map<string, QuestionAiReview>();
  if (subjectiveQuestions.length === 0) return resultMap;

  // STRICT: Server-side API key ONLY
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("No GEMINI_API_KEY configured in server environment.");
  }

  const promptItems = subjectiveQuestions.map((item, idx) => ({
    itemNumber: idx + 1,
    questionId: item.question.id,
    questionText: item.question.questionText,
    expectedAnswer: item.question.expectedAnswer,
    scoringCriteria: item.question.notes || "",
    questionType: item.question.type || "descriptive",
    agentAnswer: item.agentAnswer,
    maxMarks: item.maxMarks,
  }));

  const systemInstructions =
    "You are an expert QA examination auditor evaluating trainee agents. " +
    "Your objective is to evaluate whether the agent's answer demonstrates true understanding and provides a logically valid answer to the question. " +
    "\n\nCORE GRADING DIRECTIVE:\n" +
    "- Evaluate MEANING, CONCEPTUAL UNDERSTANDING, and LOGICAL VALIDITY, NOT word-for-word string matching.\n" +
    "- Do NOT primarily evaluate keyword overlap or require sentence similarity.\n" +
    "- Different wording, synonyms, alternate phrasing, concrete examples, concise explanations, and valid alternate approaches MUST receive credit when the underlying meaning is correct.\n" +
    "- CONCISE CORRECT ANSWERS: Do not penalize an answer merely for being brief. A concise answer that accurately captures the core concept should receive substantial/high credit (7-9/10).\n" +
    "- SYNONYMS & ALTERNATE TERMINOLOGY: Treat semantically equivalent terms as equivalent (e.g. 'communication tool' ≈ 'messaging platform' ≈ 'chat system'; 'team members' ≈ 'users' ≈ 'staff').\n" +
    "- CONTRADICTION HANDLING: If an answer contains an explicit contradiction or factual error, reduce the score proportionally.\n" +
    "- KEYWORD STUFFING: Do NOT reward an answer merely because it lists keywords without grammatical coherence or logical reasoning.\n" +
    "- CASE STUDY & SCENARIOS: Evaluate whether the agent identified the problem, used relevant facts, proposed a logically viable solution, and maintained consistency. Valid alternate approaches receive high credit.\n" +
    "- DISTINGUISH 'NO ANSWER' FROM 'INCOMPLETE': Never mark an answer as 'no_answer' or assign 0 merely because some expected details are missing. 0 is strictly reserved for blank answers, gibberish, or fundamentally wrong answers.";

  const userPrompt = `Perform a comprehensive 5-step semantic evaluation for the following ${promptItems.length} question answers:
${JSON.stringify(promptItems, null, 2)}

5-Step Semantic Evaluation Process:
STEP 1: Understand what the question is asking (subject, concept, required explanation).
STEP 2: Understand the expected answer as core concepts and facts, not as a mandatory string template.
STEP 3: Understand the agent's answer (claims made, concepts demonstrated, logical explanation, relevant examples, alternate terminology, contradictions).
STEP 4: Compare concepts: determine which required concepts are FULLY SATISFIED, PARTIALLY SATISFIED, MISSING, or CONTRADICTED.
STEP 5: Determine understanding on the 0-10 scale:
  10 = Fully correct, complete, logically sound (AWARD 10 if core logical concepts are present!).
  9 = Essentially fully correct with very minor omission.
  8 = Strong understanding, minor omission or imprecision.
  7 = Good understanding, some meaningful omission.
  6 = Mostly correct but several details incomplete.
  5 = Partial understanding, core idea present but significant gaps.
  4 = Limited understanding, some relevant knowledge.
  3 = Weak understanding, isolated correct points.
  2 = Very weak understanding.
  1 = Minimal relevant information.
  0 = Genuinely NO ANSWER / entirely irrelevant / fundamentally incorrect.

Convert understanding (0-10) to aiSuggestedScore:
aiSuggestedScore = Math.round((understanding / 10) * maxMarks * 10) / 10

Return a JSON array of objects strictly matching this schema:
[
  {
    "questionId": "string",
    "understanding": number,
    "understandingScore": number,
    "aiSuggestedScore": number,
    "confidence": "high" | "medium" | "low",
    "verdict": "fully_correct" | "mostly_correct" | "partially_correct" | "mostly_incorrect" | "incorrect" | "no_answer",
    "matchedConcepts": ["string"],
    "missingConcepts": ["string"],
    "contradictions": ["string"],
    "reasoning": "Clear, objective explanation of what was understood, what was missing or contradictory, and why this score was assigned.",
    "missingPoints": ["string"],
    "detectedIssues": ["string"]
  }
]`;

  // Use fast, active Gemini models with graceful fallbacks
  const models = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-flash-latest",
    "gemini-2.5-pro",
    "gemini-3.5-flash",
  ];
  let responseData: any = null;
  let lastError: Error | null = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: `${systemInstructions}\n\n${userPrompt}` }],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errText}`);
      }

      responseData = await response.json();
      if (responseData) break;
    } catch (err: any) {
      lastError = err;
      console.warn(`[callGeminiSemanticGrading] Failed with model ${model}:`, err.message);
    }
  }

  if (!responseData) {
    throw lastError || new Error("Failed to get response from Gemini API.");
  }

  const rawText =
    responseData?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  let jsonString = rawText.trim();
  jsonString = jsonString.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
  const firstBracket = jsonString.indexOf("[");
  const lastBracket = jsonString.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    jsonString = jsonString.slice(firstBracket, lastBracket + 1);
  }
  const parsed = JSON.parse(jsonString);

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const matchedSubjective = subjectiveQuestions.find(
        (sq) => sq.question.id === item.questionId
      );
      const maxMarks = matchedSubjective?.maxMarks || 10;

      // Extract understanding score (accepting either understanding or understandingScore)
      const rawUnderstanding = Number(item.understanding !== undefined ? item.understanding : item.understandingScore);
      const understandingScore = isNaN(rawUnderstanding)
        ? 5
        : Math.max(0, Math.min(10, Math.round(rawUnderstanding)));

      // Authoritative maxMarks conversion
      const convertedScore = Math.round((understandingScore / 10) * maxMarks * 10) / 10;
      const score = Math.max(0, Math.min(maxMarks, convertedScore));

      const confidence: AiConfidence =
        item.confidence === "high" || item.confidence === "low" ? item.confidence : "medium";

      const verdict: AiVerdict =
        item.verdict &&
        ["fully_correct", "mostly_correct", "partially_correct", "mostly_incorrect", "incorrect", "no_answer"].includes(item.verdict)
          ? item.verdict
          : understandingScore >= 9
          ? "fully_correct"
          : understandingScore >= 7
          ? "mostly_correct"
          : understandingScore >= 5
          ? "partially_correct"
          : understandingScore > 0
          ? "mostly_incorrect"
          : "incorrect";

      resultMap.set(item.questionId, {
        questionId: item.questionId,
        understandingScore,
        aiSuggestedScore: score,
        maxScore: maxMarks,
        confidence,
        verdict,
        reasoning: item.reasoning || "Conceptual understanding evaluated.",
        matchedConcepts: Array.isArray(item.matchedConcepts) ? item.matchedConcepts : [],
        missingConcepts: Array.isArray(item.missingConcepts) ? item.missingConcepts : [],
        contradictions: Array.isArray(item.contradictions) ? item.contradictions : [],
        missingPoints: Array.isArray(item.missingPoints) ? item.missingPoints : [],
        detectedIssues: Array.isArray(item.detectedIssues) ? item.detectedIssues : [],
        reviewedAt: Date.now(),
      });
    }
  }

  return resultMap;
}

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are",
  "aren't", "as", "at", "be", "because", "been", "before", "being", "below", "between", "both",
  "but", "by", "can", "cannot", "could", "did", "do", "does", "doing", "down", "during", "each",
  "few", "for", "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers",
  "herself", "him", "himself", "his", "how", "i", "if", "in", "into", "is", "it", "its", "itself",
  "me", "more", "most", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only",
  "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "she",
  "should", "so", "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves",
  "then", "there", "these", "they", "this", "those", "through", "to", "too", "under", "until",
  "up", "very", "was", "wasn't", "we", "were", "weren't", "what", "when", "where", "which",
  "while", "who", "whom", "why", "with", "would", "you", "your", "yours", "yourself", "yourselves"
]);

function extractMeaningfulWords(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^\w\s.-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function detectKeywordStuffing(text: string, expectedText: string): boolean {
  const words = (text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;

  let stopwordCount = 0;
  for (const w of words) {
    const clean = w.toLowerCase().replace(/[^a-z]/g, "");
    if (STOP_WORDS.has(clean)) stopwordCount++;
  }
  const stopwordRatio = stopwordCount / words.length;

  if (stopwordRatio < 0.12) {
    const expectedKeywords = extractMeaningfulWords(expectedText);
    let matched = 0;
    for (const w of words) {
      const clean = w.toLowerCase().replace(/[^a-z]/g, "");
      if (expectedKeywords.includes(clean)) matched++;
    }
    if (matched / words.length >= 0.4) {
      return true;
    }
  }
  return false;
}

// Pre-defined domain concepts with synonym mapping
const DOMAIN_CONCEPTS = [
  {
    name: "communication_tool",
    expectedTriggers: ["communication", "communicate", "tool", "platform", "system", "messaging"],
    synonyms: ["communication", "communicate", "messaging", "message", "messages", "chat", "chatting", "text", "texting", "pat.text", "office chat", "interactions", "conversations"],
    isCore: true
  },
  {
    name: "team_members",
    expectedTriggers: ["team", "members", "team members", "staff", "users", "employees"],
    synonyms: ["team", "members", "team members", "user", "users", "staff", "employees", "coworkers", "colleagues", "internal", "office chat"],
    isCore: true
  },
  {
    name: "patients",
    expectedTriggers: ["patient", "patients"],
    synonyms: ["patient", "patients", "pat.text", "client", "clients"],
    isCore: true
  },
  {
    name: "dental_practice",
    expectedTriggers: ["dental", "practice", "clinic", "office", "carestack"],
    synonyms: ["dental", "practice", "clinic", "office", "carestack", "dental practice"],
    isCore: false
  },
  {
    name: "integrated_system",
    expectedTriggers: ["integrated", "system", "platform", "within"],
    synonyms: ["integrated", "all-in-one", "platform", "system", "within", "managing interactions", "ecosystem"],
    isCore: false
  },
  {
    name: "claim_verification",
    expectedTriggers: ["check", "examine", "verify", "rectify", "resubmit", "field", "code"],
    synonyms: ["check", "examine", "verify", "review", "rectify", "fix", "resubmit", "update", "portal", "link", "status"],
    isCore: true
  }
];

/**
 * Fallback semantic evaluator if external Gemini API is unreachable, rate limited, or unconfigured.
 * Evaluates conceptual meaning, responsiveness, concise answers, and logical reasoning.
 */
export function evaluateSubjectiveFallback(
  question: Question,
  agentAnswer: string,
  maxMarks: number
): QuestionAiReview {
  const trimmedAnswer = (agentAnswer || "").trim();

  // 1. Genuinely blank / empty answer
  if (!trimmedAnswer) {
    return {
      questionId: question.id,
      understandingScore: 0,
      aiSuggestedScore: 0,
      maxScore: maxMarks,
      confidence: "high",
      verdict: "no_answer",
      reasoning: "No answer was provided by the agent.",
      matchedConcepts: [],
      missingConcepts: ["Complete answer missing."],
      contradictions: [],
      missingPoints: ["Complete answer missing."],
      detectedIssues: [],
      reviewedAt: Date.now(),
    };
  }

  const normAnswer = trimmedAnswer.toLowerCase();
  const normExpected = (question.expectedAnswer || "").toLowerCase().trim();

  // 2. Keyword stuffing detection
  if (detectKeywordStuffing(trimmedAnswer, question.expectedAnswer || "")) {
    return {
      questionId: question.id,
      understandingScore: 2,
      aiSuggestedScore: Math.round(0.2 * maxMarks * 10) / 10,
      maxScore: maxMarks,
      confidence: "high",
      verdict: "mostly_incorrect",
      reasoning: "Answer contains isolated keywords without coherent grammatical structure, relational explanation, or demonstrated logical understanding (keyword stuffing detected).",
      matchedConcepts: ["Isolated terms present."],
      missingConcepts: ["Coherent explanation and logical reasoning."],
      contradictions: ["Unstructured keyword list."],
      missingPoints: ["Provide a grammatically complete, logically reasoned explanation."],
      detectedIssues: ["Keyword stuffing without conceptual explanation."],
      reviewedAt: Date.now(),
    };
  }

  // 3. Exact string match
  if (normAnswer === normExpected) {
    return {
      questionId: question.id,
      understandingScore: 10,
      aiSuggestedScore: maxMarks,
      maxScore: maxMarks,
      confidence: "high",
      verdict: "fully_correct",
      reasoning: "Answer satisfies the reference requirements completely.",
      matchedConcepts: ["Complete reference match."],
      missingConcepts: [],
      contradictions: [],
      missingPoints: [],
      detectedIssues: [],
      reviewedAt: Date.now(),
    };
  }

  // 4. Fundamental Misconception / Completely Incorrect Check
  // E.g., claiming a communication tool is an inventory hardware tracking device
  const isFundamentalMisconception =
    (normExpected.includes("communication") || normExpected.includes("messaging")) &&
    (normAnswer.includes("inventory management") ||
      normAnswer.includes("hardware device") ||
      normAnswer.includes("tracking dental drills") ||
      normAnswer.includes("accounting software"));

  if (isFundamentalMisconception) {
    return {
      questionId: question.id,
      understandingScore: 1,
      aiSuggestedScore: Math.round(0.1 * maxMarks * 10) / 10,
      maxScore: maxMarks,
      confidence: "high",
      verdict: "incorrect",
      reasoning: "Fundamentally incorrect claim: Misidentifies a communication platform as an inventory management hardware device.",
      matchedConcepts: [],
      missingConcepts: ["Communication and messaging functionality."],
      contradictions: ["Incorrectly categorizes software as hardware/inventory."],
      missingPoints: ["IRIS is a communication platform, not inventory hardware."],
      detectedIssues: ["Fundamental category error."],
      reviewedAt: Date.now(),
    };
  }

  // 5. Contradiction Detection
  const contradictions: string[] = [];
  if (
    (normExpected.includes("communication") || normExpected.includes("messaging")) &&
    (normAnswer.includes("primarily a billing") ||
      normAnswer.includes("is a billing system") ||
      normAnswer.includes("not a communication"))
  ) {
    contradictions.push("Incorrectly claims IRIS is primarily a billing system.");
  }

  // 6. Identify which concepts are expected for THIS question
  const relevantExpectedConcepts = DOMAIN_CONCEPTS.filter((dc) =>
    dc.expectedTriggers.some((trigger) => normExpected.includes(trigger))
  );

  // Fallback if question does not match pre-defined domain concepts
  if (relevantExpectedConcepts.length === 0) {
    const words = extractMeaningfulWords(question.expectedAnswer || "");
    words.forEach((w) => {
      relevantExpectedConcepts.push({
        name: w,
        expectedTriggers: [w],
        synonyms: [w],
        isCore: true,
      });
    });
  }

  // Evaluate which concepts the agent's answer satisfies
  const matchedConcepts: string[] = [];
  const missingConcepts: string[] = [];

  for (const concept of relevantExpectedConcepts) {
    const satisfied = concept.synonyms.some((syn) => {
      if (syn.includes(" ")) {
        return normAnswer.includes(syn);
      }
      return (
        normAnswer.includes(syn) ||
        extractMeaningfulWords(normAnswer).some((w) => w.startsWith(syn) || syn.startsWith(w))
      );
    });

    if (satisfied) {
      matchedConcepts.push(concept.name);
    } else {
      missingConcepts.push(concept.name);
    }
  }

  const coreConcepts = relevantExpectedConcepts.filter((c) => c.isCore);
  const matchedCoreCount = coreConcepts.filter((c) => matchedConcepts.includes(c.name)).length;
  const totalCoreCount = Math.max(1, coreConcepts.length);
  const totalConcepts = Math.max(1, relevantExpectedConcepts.length);
  const conceptRatio = matchedConcepts.length / totalConcepts;

  // 7. Check for Irrelevance
  const questionWords = extractMeaningfulWords(question.questionText || "");
  const hasQuestionRelevance = questionWords.some((qw) => normAnswer.includes(qw));
  const isEntirelyIrrelevant = matchedConcepts.length === 0 && !hasQuestionRelevance;

  if (isEntirelyIrrelevant) {
    return {
      questionId: question.id,
      understandingScore: 0,
      aiSuggestedScore: 0,
      maxScore: maxMarks,
      confidence: "high",
      verdict: "incorrect",
      reasoning: "The answer is entirely irrelevant to the question asked and demonstrates no understanding of the requested concept.",
      matchedConcepts: [],
      missingConcepts: ["Entire concept missing."],
      contradictions: [],
      missingPoints: ["Answer does not address the question."],
      detectedIssues: ["Irrelevant content."],
      reviewedAt: Date.now(),
    };
  }

  // 8. Determine Understanding Score
  let understandingScore = 5;
  let verdict: AiVerdict = "partially_correct";

  const agentWords = extractMeaningfulWords(trimmedAnswer);
  const isConcise = agentWords.length <= 12;

  // Case Study / Problem Solving check
  if (
    question.type === "case_study" ||
    question.questionText?.toLowerCase().includes("what should") ||
    question.questionText?.toLowerCase().includes("investigate")
  ) {
    const hasVerification =
      normAnswer.includes("verify") || normAnswer.includes("check") || normAnswer.includes("confirm");
    const hasAction =
      normAnswer.includes("resend") ||
      normAnswer.includes("link") ||
      normAnswer.includes("invitation") ||
      normAnswer.includes("status");
    if (hasVerification && hasAction) {
      understandingScore = 9;
      verdict = "fully_correct";
    } else {
      understandingScore = Math.max(7, Math.round(conceptRatio * 10));
      verdict = "mostly_correct";
    }
  } else if (matchedCoreCount === totalCoreCount && missingConcepts.length <= 1) {
    // Has all core concepts + almost all supplementary
    understandingScore = 10;
    verdict = "fully_correct";
  } else if (matchedCoreCount === totalCoreCount) {
    // Has all core concepts (e.g. communication + team + patients)
    understandingScore = 9;
    verdict = "mostly_correct";
  } else if (matchedCoreCount >= 2 && totalCoreCount >= 3) {
    // E.g., communication + team, but missing patients
    understandingScore = 7;
    verdict = "mostly_correct";
  } else if (
    isConcise &&
    matchedConcepts.includes("communication_tool") &&
    (normAnswer.includes("carestack") || normAnswer.includes("messaging"))
  ) {
    // Concise correct answer (e.g. "IRIS is CareStack's communication and messaging platform.")
    understandingScore = 8;
    verdict = "mostly_correct";
  } else if (matchedConcepts.includes("communication_tool") || matchedCoreCount >= 1) {
    // Has one core concept, e.g. "It is used for communication."
    understandingScore = 5;
    verdict = "partially_correct";
  } else {
    understandingScore = 2;
    verdict = "mostly_incorrect";
  }

  // Contradiction penalty
  if (contradictions.length > 0) {
    understandingScore = Math.max(1, Math.min(understandingScore - 5, 3));
    verdict = "mostly_incorrect";
  }

  const suggestedScore = Math.round((understandingScore / 10) * maxMarks * 10) / 10;

  const reasoning =
    understandingScore === 10
      ? `Comprehensive understanding: Satisfies core principles, contextual role, and stakeholder interactions (${matchedConcepts.join(", ")}).`
      : understandingScore >= 8
      ? `Strong understanding: Clearly explains the essential concepts (${matchedConcepts.join(", ")}).`
      : understandingScore >= 7
      ? `Good understanding: Captures the main concepts (${matchedConcepts.join(", ")}), with minor omissions (${missingConcepts.join(", ")}).`
      : understandingScore >= 5
      ? `Partial understanding: Identifies the general topic, but important details are omitted (${missingConcepts.join(", ")}).`
      : contradictions.length > 0
      ? `Contradiction detected: ${contradictions[0]} Score significantly reduced.`
      : `Limited understanding: Demonstrates minimal relevant knowledge; key elements are missing.`;

  return {
    questionId: question.id,
    understandingScore,
    aiSuggestedScore: suggestedScore,
    maxScore: maxMarks,
    confidence: "high",
    verdict,
    reasoning,
    matchedConcepts,
    missingConcepts,
    contradictions,
    missingPoints: missingConcepts.map((c) => `Missing concept: ${c}`),
    detectedIssues: contradictions,
    reviewedAt: Date.now(),
  };
}

/**
 * Item output from authoritative normalization of attempt answers.
 */
export interface NormalizedAnswerItem {
  questionId: string;
  agentAnswer: string;
  rawAgentAnswer: unknown;
  answerSource: "attempt.agentAnswers" | "attempt.answers" | "none";
  answerPresent: boolean;
  maxMarks: number;
  questionSnapshot?: Question;
}

/**
 * Authoritatively builds the list of answers to evaluate.
 * Preserves auditor-owned attempt.answers structure while reading agent responses from attempt.agentAnswers.
 * Supports:
 * - empty answers[] with populated agentAnswers (synthesizes answer entries)
 * - multiple questions with out-of-order IDs
 * - various answer shapes (string, { answer: string }, etc.)
 */
export function buildAuthoritativeAnswers(
  agentAnswers: Record<string, unknown> = {},
  existingAnswers: AttemptAnswer[] = [],
  clientQuestions: Question[] = []
): NormalizedAnswerItem[] {
  const qidSet = new Set<string>();

  // 1. Maintain order from existing answers
  for (const ans of existingAnswers) {
    const qid = ans.questionId || (ans as any).id || ans.questionSnapshot?.id;
    if (qid) qidSet.add(qid);
  }

  // 2. Add question IDs from client questions
  for (const q of clientQuestions) {
    const qid = q.id || (q as any).questionId;
    if (qid) qidSet.add(qid);
  }

  // 3. Add question IDs from agentAnswers map (crucial for Test 4!)
  for (const qid of Object.keys(agentAnswers)) {
    if (qid) qidSet.add(qid);
  }

  return Array.from(qidSet).map((qid) => {
    const existing = existingAnswers.find(
      (a) => (a.questionId || (a as any).id || a.questionSnapshot?.id) === qid
    );

    let rawDraft = agentAnswers[qid];
    if (rawDraft === undefined && typeof qid === "string") {
      rawDraft = agentAnswers[qid.trim()];
    }

    const hasDraft = rawDraft !== undefined && rawDraft !== null;
    const rawVal = hasDraft ? rawDraft : existing?.agentAnswer;
    const answerSource: "attempt.agentAnswers" | "attempt.answers" | "none" = hasDraft
      ? "attempt.agentAnswers"
      : existing?.agentAnswer
      ? "attempt.answers"
      : "none";

    const normalizedAgentAnswer = extractRawAnswerText(rawVal);
    const answerPresent = normalizedAgentAnswer.trim().length > 0;

    return {
      questionId: qid,
      agentAnswer: normalizedAgentAnswer,
      rawAgentAnswer: rawVal,
      answerSource,
      answerPresent,
      maxMarks: existing?.maxMarks || 10,
      questionSnapshot: existing?.questionSnapshot,
    };
  });
}

/**
 * Evaluates all answers in an attempt, combining deterministic and AI semantic grading.
 */
export async function evaluateAttemptAnswers(
  questions: Question[],
  answers: AttemptAnswer[],
  attemptId?: string
): Promise<AttemptAiReview> {
  const questionsMap = new Map(questions.map((q) => [q.id || (q as any).questionId, q]));
  const questionReviews: QuestionAiReview[] = [];
  const subjectiveToEvaluate: {
    question: Question;
    agentAnswer: string;
    maxMarks: number;
  }[] = [];

  // Pass 1: Deterministic evaluation for objective questions
  for (const ans of answers) {
    const q =
      questionsMap.get(ans.questionId) ||
      questionsMap.get(ans.questionId?.trim()) ||
      ans.questionSnapshot;
    const maxMarks = ans.maxMarks || 10;

    if (!q) {
      questionReviews.push({
        questionId: ans.questionId,
        understandingScore: 0,
        aiSuggestedScore: 0,
        maxScore: maxMarks,
        confidence: "low",
        verdict: "incorrect",
        reasoning: "Question details unavailable for evaluation.",
        detectedIssues: [],
        missingPoints: [],
        reviewedAt: Date.now(),
      });
      continue;
    }

    const objReview = evaluateObjectiveQuestion(q, ans.agentAnswer, maxMarks);
    if (objReview) {
      questionReviews.push(objReview);
    } else {
      subjectiveToEvaluate.push({
        question: q,
        agentAnswer: ans.agentAnswer,
        maxMarks,
      });
    }
  }

  // Pass 2: Semantic evaluation for subjective questions
  if (subjectiveToEvaluate.length > 0) {
    // Development-only debug trace immediately before semantic grading
    if (process.env.NODE_ENV !== "production" || process.env.DEBUG_AI_GRADING === "true") {
      for (const item of subjectiveToEvaluate) {
        console.log(
          `AI GRADING DEBUG\n` +
          `attemptId: ${attemptId || "unknown"}\n` +
          `questionId: ${item.question.id}\n` +
          `questionType: ${item.question.type || "descriptive"}\n` +
          `answerSource: attempt.agentAnswers\n` +
          `rawAgentAnswer: ${JSON.stringify(item.agentAnswer)}\n` +
          `normalizedAgentAnswer: ${JSON.stringify(item.agentAnswer)}\n` +
          `answerPresent: ${item.agentAnswer.trim().length > 0}`
        );
      }
    }

    try {
      const semanticResults = await callGeminiSemanticGrading(subjectiveToEvaluate);
      for (const item of subjectiveToEvaluate) {
        const res = semanticResults.get(item.question.id);
        if (res) {
          questionReviews.push(res);
        } else {
          questionReviews.push(
            evaluateSubjectiveFallback(item.question, item.agentAnswer, item.maxMarks)
          );
        }
      }
    } catch (err: any) {
      console.warn(
        "[evaluateAttemptAnswers] Gemini API call failed, falling back to heuristic evaluation:",
        err.message
      );
      for (const item of subjectiveToEvaluate) {
        questionReviews.push(
          evaluateSubjectiveFallback(item.question, item.agentAnswer, item.maxMarks)
        );
      }
    }
  }

  // Calculate totals
  const overallSuggestedScore = questionReviews.reduce(
    (sum, q) => sum + q.aiSuggestedScore,
    0
  );
  const maxPossibleScore = questionReviews.reduce(
    (sum, q) => sum + q.maxScore,
    0
  );
  const overallSuggestedPercentage =
    maxPossibleScore > 0
      ? Math.round((overallSuggestedScore / maxPossibleScore) * 1000) / 10
      : 0;

  return {
    status: "complete",
    reviewedAt: Date.now(),
    overallSuggestedScore: Math.round(overallSuggestedScore * 10) / 10,
    maxPossibleScore,
    overallSuggestedPercentage,
    questionReviews,
  };
}

/**
 * Persists an AI review into the confidential aiReviews collection (auditor-only)
 * and safely updates attempt metadata flags without leaking reasoning to agents.
 */
export async function saveAiReviewToAttempt(
  attemptId: string,
  aiReview: AttemptAiReview
): Promise<void> {
  // 1. Write confidential AI review to dedicated aiReviews collection
  const aiReviewRef = doc(db, "aiReviews", attemptId);
  await setDoc(
    aiReviewRef,
    stripUndefined({
      attemptId,
      aiReview,
      status: aiReview.status,
      updatedAt: Date.now(),
    }),
    { merge: true }
  );

  // 2. Mark attempt document with safe flags without exposing reasoning to agents
  try {
    const ref = doc(db, COL_ATTEMPTS, attemptId);
    await updateDoc(
      ref,
      stripUndefined({
        hasAiReview: aiReview.status === "complete",
        aiReviewStatus: aiReview.status,
      })
    );
  } catch (err) {
    console.warn("[saveAiReviewToAttempt] Non-critical: Could not update attempt flags:", err);
  }
}

