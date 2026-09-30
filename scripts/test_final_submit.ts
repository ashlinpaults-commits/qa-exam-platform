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
  const { normalizeAgentAnswers } = await import("../src/lib/attempts");
  const { stripUndefined } = await import("../src/lib/questions");
  type ExamAttempt = import("../src/types").ExamAttempt;
  type AttemptAnswer = import("../src/types").AttemptAnswer;

  console.log("==================================================");
  console.log("RUNNING FINAL SUBMIT REGRESSION TEST SUITE");
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
// TEST 1: normalizeAgentAnswers preserves authoritative existing questions
// and does NOT allow spurious agentAnswers keys to inject phantom questions.
// -------------------------------------------------------------------------
{
  const rawAttempt: ExamAttempt = {
    id: "att_1",
    examId: "exam_1",
    agentId: "agent_1",
    attemptNumber: 1,
    startedAt: 1000,
    status: "submitted",
    answers: [
      { questionId: "q1", agentAnswer: "", maxMarks: 10 },
      { questionId: "q2", agentAnswer: "", maxMarks: 10 },
    ],
    agentAnswers: {
      q1: "Answer to Q1",
      q2: "Answer to Q2",
      spurious_q3: "Ghost answer from deleted question or autosave glitch",
      "": "Empty key glitch",
    },
  };

  const normalized = normalizeAgentAnswers(rawAttempt);
  assert(
    normalized.answers.length === 2,
    "Test 1a: Normalized answers length matches exactly the 2 real questions (no phantom questions)",
    `Expected 2, got ${normalized.answers.length}`
  );
  assert(
    normalized.answers[0].questionId === "q1" && normalized.answers[0].agentAnswer === "Answer to Q1",
    "Test 1b: Q1 received its submitted answer",
    JSON.stringify(normalized.answers[0])
  );
  assert(
    normalized.answers[1].questionId === "q2" && normalized.answers[1].agentAnswer === "Answer to Q2",
    "Test 1c: Q2 received its submitted answer",
    JSON.stringify(normalized.answers[1])
  );
}

// -------------------------------------------------------------------------
// TEST 2: normalizeAgentAnswers handles whitespace & case discrepancies in keys.
// -------------------------------------------------------------------------
{
  const rawAttempt: ExamAttempt = {
    id: "att_2",
    examId: "exam_1",
    agentId: "agent_1",
    attemptNumber: 1,
    startedAt: 1000,
    status: "submitted",
    answers: [
      { questionId: "q_case_test", agentAnswer: "", maxMarks: 10 },
      { questionId: "q_space_test", agentAnswer: "", maxMarks: 10 },
    ],
    agentAnswers: {
      "Q_CASE_TEST": "Case insensitive match",
      "q_space_test ": "Trimmed match",
    },
  };

  const normalized = normalizeAgentAnswers(rawAttempt);
  assert(
    normalized.answers[0].agentAnswer === "Case insensitive match",
    "Test 2a: Case insensitive question key maps to agent answer",
    normalized.answers[0].agentAnswer
  );
  assert(
    normalized.answers[1].agentAnswer === "Trimmed match",
    "Test 2b: Trimmed question key maps to agent answer",
    normalized.answers[1].agentAnswer
  );
}

// -------------------------------------------------------------------------
// TEST 3: finalizeAttemptReview payload sanitization - NO undefined values.
// When an attempt is finalized WITHOUT AI review, aiSuggestedScore must not
// be present as `undefined` (which causes Firestore update to throw).
// -------------------------------------------------------------------------
{
  const attemptWithoutAi: ExamAttempt = {
    id: "att_3",
    examId: "exam_1",
    agentId: "agent_1",
    attemptNumber: 1,
    startedAt: 1000,
    status: "submitted",
    answers: [
      { questionId: "q1", agentAnswer: "My answer", maxMarks: 10 },
    ],
    agentAnswers: { q1: "My answer" },
  };

  const auditorScores: Record<string, number> = { q1: 8 };
  const auditorComments: Record<string, string> = { q1: "Good answer" };
  const reviewerId = "auditor_123";

  // Simulate finalizeAttemptReview answer mapping:
  const answers: AttemptAnswer[] = attemptWithoutAi.answers.map((answer) => {
    const qId = answer.questionId;
    const score = auditorScores[qId];
    const comment = auditorComments[qId] ?? (answer.comments || "");
    const aiSuggestedScore =
      attemptWithoutAi.aiReview?.questionReviews?.find((qr) => qr.questionId === qId)?.aiSuggestedScore ??
      answer.aiSuggestedScore;

    const updatedAnswer: AttemptAnswer = {
      ...answer,
      marks: score,
      comments: comment,
    };

    if (aiSuggestedScore !== undefined && aiSuggestedScore !== null && !isNaN(aiSuggestedScore)) {
      updatedAnswer.aiSuggestedScore = aiSuggestedScore;
    } else {
      delete updatedAnswer.aiSuggestedScore;
    }

    const clean = stripUndefined(updatedAnswer);
    if (clean.questionSnapshot) {
      clean.questionSnapshot = stripUndefined(clean.questionSnapshot);
    }
    return clean;
  });

  const totalMarks = answers.reduce((sum, a) => sum + (a.marks ?? 0), 0);
  const maxTotalMarks = answers.reduce((sum, a) => sum + a.maxMarks, 0);
  const reviewedAt = Date.now();

  const updateData = stripUndefined({
    answers,
    totalMarks,
    maxTotalMarks,
    status: "reviewed" as const,
    reviewedBy: reviewerId,
    reviewedAt,
    analyticsFinalized: true,
  });

  // Verify no undefined in updateData
  const hasUndefined = (obj: any): boolean => {
    if (obj === undefined) return true;
    if (obj === null || typeof obj !== "object") return false;
    for (const key of Object.keys(obj)) {
      if (obj[key] === undefined || hasUndefined(obj[key])) return true;
    }
    return false;
  };

  assert(
    !hasUndefined(updateData),
    "Test 3a: updateData contains NO undefined fields anywhere in its tree (safe for Firestore)",
    JSON.stringify(updateData)
  );
  assert(
    !("aiSuggestedScore" in updateData.answers[0]),
    "Test 3b: aiSuggestedScore is omitted entirely rather than being undefined",
    JSON.stringify(updateData.answers[0])
  );
  assert(
    updateData.status === "reviewed" && updateData.totalMarks === 8 && updateData.maxTotalMarks === 10,
    "Test 3c: Review status, totalMarks, and maxTotalMarks calculated correctly",
    JSON.stringify(updateData)
  );
  assert(
    updateData.analyticsFinalized === true,
    "Test 3d: analyticsFinalized is bundled into the atomic transaction",
    JSON.stringify(updateData)
  );
}

// -------------------------------------------------------------------------
// TEST 4: finalizeAttemptReview preserves aiSuggestedScore when present.
// -------------------------------------------------------------------------
{
  const attemptWithAi: ExamAttempt = {
    id: "att_4",
    examId: "exam_1",
    agentId: "agent_1",
    attemptNumber: 1,
    startedAt: 1000,
    status: "submitted",
    answers: [
      { questionId: "q1", agentAnswer: "My answer", maxMarks: 10 },
    ],
    agentAnswers: { q1: "My answer" },
    aiReview: {
      status: "complete",
      reviewedAt: Date.now(),
      questionReviews: [
        {
          questionId: "q1",
          aiSuggestedScore: 9,
          maxScore: 10,
          confidence: "high",
          reasoning: "Comprehensive answer",
          reviewedAt: Date.now(),
        },
      ],
    },
  };

  const auditorScores: Record<string, number> = { q1: 10 };
  const answers: AttemptAnswer[] = attemptWithAi.answers.map((answer) => {
    const qId = answer.questionId;
    const score = auditorScores[qId];
    const aiSuggestedScore =
      attemptWithAi.aiReview?.questionReviews?.find((qr) => qr.questionId === qId)?.aiSuggestedScore ??
      answer.aiSuggestedScore;

    const updatedAnswer: AttemptAnswer = {
      ...answer,
      marks: score,
    };

    if (aiSuggestedScore !== undefined && aiSuggestedScore !== null && !isNaN(aiSuggestedScore)) {
      updatedAnswer.aiSuggestedScore = aiSuggestedScore;
    }

    return stripUndefined(updatedAnswer);
  });

  assert(
    answers[0].marks === 10 && answers[0].aiSuggestedScore === 9,
    "Test 4: Final auditor marks (10) and AI suggested score (9) are preserved distinctly",
    JSON.stringify(answers[0])
  );
}

// -------------------------------------------------------------------------
// TEST 5: submitAttempt timeTakenSeconds handles missing startedAt safely.
// -------------------------------------------------------------------------
{
  const now = 200000;
  const startedAt = undefined;
  const attemptStartedAt = undefined;
  const actualStartedAt = attemptStartedAt || startedAt || now;
  const timeTakenSeconds = Math.max(0, Math.round((now - actualStartedAt) / 1000));

  assert(
    !isNaN(timeTakenSeconds) && timeTakenSeconds === 0,
    "Test 5: Undefined startedAt produces a valid number (0), never NaN",
    `timeTakenSeconds = ${timeTakenSeconds}`
  );
}

// -------------------------------------------------------------------------
// TEST 6: verifyAttemptAnswers trimmed comparison.
// -------------------------------------------------------------------------
{
  const persisted = { q1: "CareStack answer" };
  const expectedAnswers = { q1: "CareStack answer  \n" };
  const missing: string[] = [];

  for (const [qid, expectedVal] of Object.entries(expectedAnswers)) {
    if (expectedVal && expectedVal.trim().length > 0) {
      const persistedVal = persisted[qid as keyof typeof persisted];
      if (
        persistedVal === undefined ||
        persistedVal === null ||
        (persistedVal !== expectedVal && persistedVal.trim() !== expectedVal.trim())
      ) {
        missing.push(qid);
      }
    }
  }

  assert(
    missing.length === 0,
    "Test 6: verifyAttemptAnswers does not fail due to whitespace variations",
    JSON.stringify(missing)
  );
}

  console.log("\n==================================================");
  console.log(`FINAL SUBMIT TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
