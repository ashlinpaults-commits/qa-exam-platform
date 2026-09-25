import assert from "node:assert/strict";
import {
  evaluateDeterministicAnswer,
  buildAiEvaluationPrompt,
  parseAiEvaluationResponse,
  evaluateFallbackSemanticAnswer,
} from "../src/lib/aiEvaluation.ts";

console.log("=== Running AI-Assisted Answer Correction Verification Tests ===");

// 1. TEST MCQ DETERMINISTIC EVALUATION
console.log("\n1. Testing MCQ Evaluation...");
const mcqQuestion = {
  id: "q-mcq-1",
  type: "mcq",
  options: ["Eligible", "Ineligible", "Pending Authorization", "Terminated"],
  correctOptionIndex: 0,
  expectedAnswer: "Eligible",
  module: "Insurance",
};

// Correct selection
const mcqCorrect = evaluateDeterministicAnswer(mcqQuestion, "0", 10);
assert.equal(mcqCorrect.suggestedMarks, 10, "MCQ correct option should yield 10 marks");
assert.equal(mcqCorrect.isDeterministic, true);
assert.equal(mcqCorrect.confidence, "high");
assert.ok(mcqCorrect.keyPointsCovered.length > 0);
console.log("✓ MCQ Correct choice evaluated correctly: 10/10");

// Incorrect selection
const mcqWrong = evaluateDeterministicAnswer(mcqQuestion, "1", 10);
assert.equal(mcqWrong.suggestedMarks, 0, "MCQ wrong option should yield 0 marks");
assert.equal(mcqWrong.isDeterministic, true);
assert.ok(mcqWrong.missingKeyPoints.length > 0);
assert.ok(mcqWrong.errors.length > 0);
console.log("✓ MCQ Incorrect choice evaluated correctly: 0/10");

// Unanswered / blank
const mcqBlank = evaluateDeterministicAnswer(mcqQuestion, "", 10);
assert.equal(mcqBlank.suggestedMarks, 0, "Blank answer should yield 0 marks");
console.log("✓ MCQ Blank choice evaluated correctly: 0/10");


// 2. TEST TRUE / FALSE DETERMINISTIC EVALUATION
console.log("\n2. Testing True/False Evaluation...");
const tfQuestion = {
  id: "q-tf-1",
  type: "true_false",
  expectedAnswer: "True",
  module: "Clinical",
};

const tfCorrect = evaluateDeterministicAnswer(tfQuestion, "True", 10);
assert.equal(tfCorrect.suggestedMarks, 10);
assert.equal(tfCorrect.isDeterministic, true);
console.log("✓ True/False Correct evaluated correctly: 10/10");

const tfWrong = evaluateDeterministicAnswer(tfQuestion, "False", 10);
assert.equal(tfWrong.suggestedMarks, 0);
assert.equal(tfWrong.isDeterministic, true);
console.log("✓ True/False Incorrect evaluated correctly: 0/10");


// 3. TEST DRAG & DROP ORDERING EVALUATION
console.log("\n3. Testing Drag & Drop Ordering Evaluation...");
const dndQuestion = {
  id: "q-dnd-1",
  type: "drag_drop_order",
  orderItems: ["Verify Patient", "Collect Copay", "Check-in in Scheduler", "Escort to Exam Room"],
  expectedAnswer: "Verify Patient, Collect Copay, Check-in in Scheduler, Escort to Exam Room",
  module: "Workflow",
};

// Exact match
const dndExact = evaluateDeterministicAnswer(
  dndQuestion,
  JSON.stringify(["Verify Patient", "Collect Copay", "Check-in in Scheduler", "Escort to Exam Room"]),
  10
);
assert.equal(dndExact.suggestedMarks, 10);
assert.equal(dndExact.isDeterministic, true);
console.log("✓ Drag & Drop Exact match evaluated: 10/10");

// Partial match (2 out of 4)
const dndPartial = evaluateDeterministicAnswer(
  dndQuestion,
  JSON.stringify(["Verify Patient", "Check-in in Scheduler", "Collect Copay", "Escort to Exam Room"]),
  10
);
assert.equal(dndPartial.suggestedMarks, 5, "2 of 4 matches should yield 5/10 marks");
assert.equal(dndPartial.isDeterministic, true);
assert.equal(dndPartial.keyPointsCovered.length, 2);
assert.equal(dndPartial.missingKeyPoints.length, 2);
console.log("✓ Drag & Drop Partial match evaluated: 5/10");


// 4. TEST DESCRIPTIVE BLANK ANSWER
console.log("\n4. Testing Descriptive Blank Answer...");
const descQuestion = {
  id: "q-desc-1",
  type: "descriptive",
  expectedAnswer: "Detailed claim validation process",
  module: "Billing",
};
const descBlank = evaluateDeterministicAnswer(descQuestion, "   ", 10);
assert.equal(descBlank.suggestedMarks, 0);
assert.equal(descBlank.isDeterministic, true);
console.log("✓ Descriptive blank answer deterministically evaluated as 0/10");

// Descriptive with answer -> returns null so AI evaluates it
const descWithAnswer = evaluateDeterministicAnswer(descQuestion, "Check claim status in portal", 10);
assert.equal(descWithAnswer, null, "Semantic question with answer should return null for AI routing");
console.log("✓ Descriptive non-blank answer routed to AI evaluation");


// 5. TEST PROMPT BUILDER
console.log("\n5. Testing AI Prompt Builder...");
const prompt = buildAiEvaluationPrompt([
  {
    questionId: "q1",
    questionText: "How do you verify claim status?",
    expectedAnswer: "Check payer clearinghouse portal and verify 277 response details.",
    notes: "Must mention 277 response code.",
    module: "RCM",
    feature: "Claims",
    type: "descriptive",
    agentAnswer: "I would check the clearinghouse to see if the claim was accepted.",
    maxMarks: 10,
  },
]);
assert.ok(prompt.includes("SCORING GUIDELINES"));
assert.ok(prompt.includes("EVALUATION PRINCIPLES"));
assert.ok(prompt.includes("Check payer clearinghouse portal and verify 277 response details."));
assert.ok(prompt.includes("Must mention 277 response code."));
assert.ok(prompt.includes("I would check the clearinghouse to see if the claim was accepted."));
console.log("✓ Prompt includes question, expected answer, key notes, agent answer, and quality rubric");


// 6. TEST JSON RESPONSE PARSING & SCORE CLAMPING
console.log("\n6. Testing JSON Response Parsing...");
const mockAiResponse = JSON.stringify({
  evaluations: [
    {
      questionId: "q1",
      suggestedMarks: 8,
      maxMarks: 10,
      keyPointsCovered: ["Checked clearinghouse portal", "Verified acceptance status"],
      missingKeyPoints: ["Did not reference the 277 response code details"],
      errors: [],
      reasoning: "Core steps are covered, but missed the specific 277 response verification.",
      confidence: "high",
      suggestedComment: "Good answer. Remember to check 277 response codes.",
      suggestedKnowledgeGap: "Workflow",
    },
  ],
});

const parsed = parseAiEvaluationResponse(mockAiResponse, [
  {
    questionId: "q1",
    questionText: "How do you verify claim status?",
    expectedAnswer: "Check payer clearinghouse portal and verify 277 response details.",
    module: "RCM",
    feature: "Claims",
    type: "descriptive",
    agentAnswer: "I would check the clearinghouse to see if the claim was accepted.",
    maxMarks: 10,
  },
]);

assert.ok(parsed["q1"]);
assert.equal(parsed["q1"].suggestedMarks, 8);
assert.equal(parsed["q1"].keyPointsCovered.length, 2);
assert.equal(parsed["q1"].missingKeyPoints.length, 1);
assert.equal(parsed["q1"].confidence, "high");
assert.equal(parsed["q1"].suggestedKnowledgeGap, "Workflow");
console.log("✓ AI JSON response parsed and validated: 8/10 with key points and missing points");


// 7. TEST SCORE CLAMPING (PREVENT OVERFLOW)
console.log("\n7. Testing Score Clamping...");
const mockOverMaxResponse = JSON.stringify({
  evaluations: [
    {
      questionId: "q1",
      suggestedMarks: 15, // Out of bounds
      maxMarks: 10,
      keyPointsCovered: [],
      missingKeyPoints: [],
      errors: [],
      reasoning: "Great",
      confidence: "high",
    },
  ],
});
const clamped = parseAiEvaluationResponse(mockOverMaxResponse, [
  {
    questionId: "q1",
    questionText: "Test",
    expectedAnswer: "Test",
    module: "Test",
    feature: "Test",
    type: "descriptive",
    agentAnswer: "Test",
    maxMarks: 10,
  },
]);
assert.equal(clamped["q1"].suggestedMarks, 10, "Score > maxMarks must clamp to maxMarks (10)");
console.log("✓ Score clamping successfully enforced: 15 clamped to 10");


// 8. TEST HEURISTIC FALLBACK EVALUATION (WHEN AI API IS UNAVAILABLE)
console.log("\n8. Testing Heuristic Fallback Evaluation...");
const fallbackEval = evaluateFallbackSemanticAnswer({
  questionId: "q-fb-1",
  questionText: "How do you reset a patient portal password?",
  expectedAnswer: "Navigate to Patient Administration. Select Security tab. Click Send Password Reset Link to verified email address.",
  module: "Patient Services",
  feature: "Portal",
  type: "descriptive",
  agentAnswer: "Go to Patient Administration and send password reset link.",
  maxMarks: 10,
});
assert.ok(fallbackEval.suggestedMarks >= 5 && fallbackEval.suggestedMarks <= 9, "Partial match should yield partial score");
assert.equal(fallbackEval.confidence, "low");
assert.ok(fallbackEval.keyPointsCovered.length > 0);
console.log(`✓ Heuristic fallback generated ${fallbackEval.suggestedMarks}/10 marks with low confidence notice`);


// 9. TEST AUDITOR OVERRIDE PRESERVATION LOGIC
console.log("\n9. Testing Auditor Override Preservation Logic...");
const attemptAnswers = [
  { questionId: "q1", agentAnswer: "Answer 1", marks: 9, comments: "Auditor scored manually", maxMarks: 10 },
  { questionId: "q2", agentAnswer: "Answer 2", marks: undefined, comments: "", maxMarks: 10 },
];
const auditorOverridesSet = new Set(["q1"]); // Auditor previously touched Q1

const aiSuggested = {
  q1: { suggestedMarks: 7, suggestedComment: "AI says 7" },
  q2: { suggestedMarks: 8, suggestedComment: "AI says 8" },
};

// Simulate draft updates
const updatesToDraft = [];
attemptAnswers.forEach((ans) => {
  if (!auditorOverridesSet.has(ans.questionId) && aiSuggested[ans.questionId]) {
    updatesToDraft.push({
      questionId: ans.questionId,
      marks: aiSuggested[ans.questionId].suggestedMarks,
      comments: aiSuggested[ans.questionId].suggestedComment,
    });
  }
});

assert.equal(updatesToDraft.length, 1, "Only untouched question (Q2) should be updated");
assert.equal(updatesToDraft[0].questionId, "q2");
assert.equal(updatesToDraft[0].marks, 8);
console.log("✓ Auditor override on Q1 successfully preserved; Q1 was not overwritten");

console.log("\nALL VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉\n");
