import fs from "fs";
import path from "path";

// Read .env.local BEFORE importing any module that uses env vars
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        process.env[key] = val;
      }
    }
  }
}

async function runTests() {
  const { buildAuthoritativeAnswers, evaluateAttemptAnswers, evaluateObjectiveQuestion } = await import("../src/lib/aiReview");
  const { extractRawAnswerText } = await import("../src/lib/questions");

  console.log("==================================================");
  console.log("RUNNING AI ANSWER INGESTION REGRESSION TEST SUITE");
  console.log("==================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} ${detail ? `\n  -> ${detail}` : ""}`);
      failed++;
    }
  }

  // -------------------------------------------------------------------------
  // TEST 1: agentAnswers contains descriptive answer.
  // Expected: AI payload contains exact answer.
  // -------------------------------------------------------------------------
  {
    const agentAnswers = {
      q1: "A descriptive explanation of claims submission in CareStack.",
    };
    const answers = [
      {
        questionId: "q1",
        agentAnswer: "",
        maxMarks: 10,
      },
    ];
    const normalized = buildAuthoritativeAnswers(agentAnswers, answers);
    assert(
      normalized.length === 1 &&
        normalized[0].questionId === "q1" &&
        normalized[0].agentAnswer === "A descriptive explanation of claims submission in CareStack." &&
        normalized[0].answerSource === "attempt.agentAnswers" &&
        normalized[0].answerPresent === true,
      "Test 1: agentAnswers contains descriptive answer -> AI payload contains exact answer"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 2: agentAnswers contains multiple questions.
  // Expected: Each question receives its own correct answer.
  // -------------------------------------------------------------------------
  {
    const agentAnswers = {
      q1: "Answer for Question 1",
      q2: "Answer for Question 2",
      q3: "Answer for Question 3",
    };
    const answers = [
      { questionId: "q1", agentAnswer: "", maxMarks: 10 },
      { questionId: "q2", agentAnswer: "", maxMarks: 10 },
      { questionId: "q3", agentAnswer: "", maxMarks: 10 },
    ];
    const normalized = buildAuthoritativeAnswers(agentAnswers, answers);
    const m1 = normalized.find((n) => n.questionId === "q1")?.agentAnswer === "Answer for Question 1";
    const m2 = normalized.find((n) => n.questionId === "q2")?.agentAnswer === "Answer for Question 2";
    const m3 = normalized.find((n) => n.questionId === "q3")?.agentAnswer === "Answer for Question 3";
    assert(
      normalized.length === 3 && m1 && m2 && m3,
      "Test 2: agentAnswers contains multiple questions -> Each question receives its own correct answer"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 3: question IDs are not in the same array order.
  // Expected: Answers still map correctly by questionId.
  // -------------------------------------------------------------------------
  {
    const agentAnswers = {
      q_alpha: "Alpha Answer",
      q_beta: "Beta Answer",
      q_gamma: "Gamma Answer",
    };
    // answers array in reverse order: gamma, alpha, beta
    const answers = [
      { questionId: "q_gamma", agentAnswer: "", maxMarks: 10 },
      { questionId: "q_alpha", agentAnswer: "", maxMarks: 10 },
      { questionId: "q_beta", agentAnswer: "", maxMarks: 10 },
    ];
    const normalized = buildAuthoritativeAnswers(agentAnswers, answers);
    const gAns = normalized.find((n) => n.questionId === "q_gamma")?.agentAnswer;
    const aAns = normalized.find((n) => n.questionId === "q_alpha")?.agentAnswer;
    const bAns = normalized.find((n) => n.questionId === "q_beta")?.agentAnswer;
    assert(
      gAns === "Gamma Answer" && aAns === "Alpha Answer" && bAns === "Beta Answer",
      "Test 3: question IDs are not in the same array order -> Answers map correctly by questionId"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 4: answers[] is empty but agentAnswers contains answers.
  // Expected: AI still receives agent answers. This is extremely important.
  // -------------------------------------------------------------------------
  {
    const agentAnswers = {
      q_standalone_1: "Standalone Answer 1",
      q_standalone_2: { answer: "Standalone Answer 2 wrapped in object" },
    };
    const emptyAnswers: any[] = [];
    const normalized = buildAuthoritativeAnswers(agentAnswers, emptyAnswers);
    const s1 = normalized.find((n) => n.questionId === "q_standalone_1")?.agentAnswer;
    const s2 = normalized.find((n) => n.questionId === "q_standalone_2")?.agentAnswer;
    assert(
      normalized.length === 2 &&
        s1 === "Standalone Answer 1" &&
        s2 === "Standalone Answer 2 wrapped in object",
      "Test 4: answers[] is empty but agentAnswers contains answers -> AI still receives agent answers"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 5: agentAnswers is empty.
  // Expected: "No answer" is returned.
  // -------------------------------------------------------------------------
  {
    const agentAnswers = {};
    const answers = [
      { questionId: "q_empty", agentAnswer: "", maxMarks: 10 },
    ];
    const normalized = buildAuthoritativeAnswers(agentAnswers, answers);
    assert(
      normalized.length === 1 &&
        normalized[0].agentAnswer === "" &&
        normalized[0].answerPresent === false,
      "Test 5: agentAnswers is empty -> answerPresent is false and normalized answer is empty string"
    );

    const q = {
      id: "q_empty",
      questionText: "Explain dental co-pays.",
      type: "descriptive" as const,
      expectedAnswer: "Co-pays are predetermined patient out-of-pocket costs.",
      maxMarks: 10,
    };
    const evalRes = evaluateObjectiveQuestion(q as any, normalized[0].agentAnswer, 10);
    assert(
      evalRes !== null &&
        evalRes.verdict === "no_answer" &&
        evalRes.understandingScore === 0 &&
        evalRes.aiSuggestedScore === 0 &&
        evalRes.reasoning === "No answer was provided by the agent." &&
        (evalRes.missingPoints?.includes("Complete answer missing.") ?? false),
      "Test 5b: agentAnswers is empty -> evaluateObjectiveQuestion returns no_answer"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 6: agentAnswers contains whitespace only.
  // Expected: "No answer" is returned.
  // -------------------------------------------------------------------------
  {
    const agentAnswers = {
      q_whitespace: "   \n\t   \n  ",
    };
    const answers = [
      { questionId: "q_whitespace", agentAnswer: "", maxMarks: 10 },
    ];
    const normalized = buildAuthoritativeAnswers(agentAnswers, answers);
    assert(
      normalized.length === 1 && normalized[0].answerPresent === false,
      "Test 6: agentAnswers contains whitespace only -> answerPresent is false"
    );

    const q = {
      id: "q_whitespace",
      questionText: "What is an EOB in dental billing?",
      type: "descriptive" as const,
      expectedAnswer: "Explanation of Benefits.",
      maxMarks: 10,
    };
    const evalRes = evaluateObjectiveQuestion(q as any, normalized[0].agentAnswer, 10);
    assert(
      evalRes !== null &&
        evalRes.verdict === "no_answer" &&
        evalRes.understandingScore === 0 &&
        evalRes.aiSuggestedScore === 0 &&
        evalRes.reasoning === "No answer was provided by the agent." &&
        (evalRes.missingPoints?.includes("Complete answer missing.") ?? false),
      "Test 6b: agentAnswers contains whitespace only -> evaluateObjectiveQuestion returns no_answer"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 7: IRIS example.
  // Expected: AI receives the complete agent answer and does NOT classify it as no_answer.
  // -------------------------------------------------------------------------
  {
    const irisQuestionId = "r4FLnE6W1OizCMGcfmyb";
    const irisQuestionText = "What is IRIS in CareStack?";
    const irisExpectedAnswer =
      "IRIS is a communication tool that helps dental practices communicate with team members and patients within an integrated system.";
    const irisAgentAnswer =
      "IRIS is the text messaging platform for users and patients. The messaging between users are done in Office chat in IRIS and the messaging between users and patients are done in Pat.Text. It is the platform's communication tool for managing interactions within the dental practice and with patients.";

    const agentAnswers = {
      [irisQuestionId]: irisAgentAnswer,
    };
    // Simulate Firestore attempt.answers starting with blank agentAnswer
    const answers = [
      {
        questionId: irisQuestionId,
        agentAnswer: "",
        maxMarks: 10,
        questionSnapshot: {
          id: irisQuestionId,
          questionText: irisQuestionText,
          type: "descriptive" as const,
          expectedAnswer: irisExpectedAnswer,
          maxMarks: 10,
        } as any,
      },
    ];

    const normalized = buildAuthoritativeAnswers(agentAnswers, answers);
    const irisItem = normalized[0];

    assert(
      irisItem.questionId === irisQuestionId &&
        irisItem.agentAnswer === irisAgentAnswer &&
        irisItem.answerPresent === true &&
        irisItem.answerSource === "attempt.agentAnswers",
      "Test 7a: IRIS example -> Normalized answer matches exact agent submission with answerPresent=true"
    );

    const question = {
      id: irisQuestionId,
      questionText: irisQuestionText,
      type: "descriptive" as const,
      expectedAnswer: irisExpectedAnswer,
      maxMarks: 10,
    };
    const answerEntry = {
      questionId: irisQuestionId,
      agentAnswer: irisItem.agentAnswer,
      maxMarks: 10,
      questionSnapshot: question as any,
    };

    const evalResult = await evaluateAttemptAnswers([question as any], [answerEntry]);
    const irisReview = evalResult.questionReviews.find((r) => r.questionId === irisQuestionId);

    assert(
      irisReview !== undefined &&
        irisReview.verdict !== "no_answer" &&
        (irisReview.understandingScore ?? 0) >= 9 &&
        irisReview.aiSuggestedScore >= 9,
      `Test 7b: IRIS example -> Evaluated with score ${irisReview?.aiSuggestedScore}/10, verdict: "${irisReview?.verdict}" (NOT classified as no_answer)`
    );
  }

  console.log("\n==================================================");
  console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Unhandled error running tests:", err);
  process.exit(1);
});
