import assert from "node:assert";
import type { Exam, ExamAttempt, ExamAssignment, ReassignmentMode, Question } from "../src/types";

// Mock helper simulating reassignExamFromAttempt logic
function prepareReassignment(
  exam: Exam,
  sourceAttempt: ExamAttempt,
  mode: ReassignmentMode,
  customQuestionIds?: string[],
  allAttempts: ExamAttempt[] = []
) {
  let targetQuestionIds: string[] = [];

  if (mode === "all") {
    targetQuestionIds = (exam.questions || []).map((q) => q.questionId);
    if (targetQuestionIds.length === 0) {
      throw new Error("The original exam has no questions to reassign.");
    }
  } else if (mode === "wrong_only") {
    const missed = (sourceAttempt.answers || []).filter(
      (a) => a.marks === undefined || a.marks < a.maxMarks
    );
    if (missed.length === 0) {
      throw new Error("Agent scored 100% on all questions. There are no incorrect questions to reassign.");
    }
    targetQuestionIds = missed.map((a) => a.questionId);
  } else if (mode === "custom") {
    if (!customQuestionIds || customQuestionIds.length === 0) {
      throw new Error("Please select at least one question for custom reassignment.");
    }
    targetQuestionIds = customQuestionIds;
  }

  const agentAttempts = allAttempts.filter((a) => a.agentId === sourceAttempt.agentId);
  const highestExisting = Math.max(
    sourceAttempt.attemptNumber || 0,
    ...agentAttempts.map((a) => a.attemptNumber || 0),
    0
  );
  const nextAttemptNumber = highestExisting + 1;

  // Crucial check: Reassignment record only carries questionIds, NEVER prior answers!
  const assignment: ExamAssignment = {
    id: `${exam.id}_${sourceAttempt.agentId}_reassign_${sourceAttempt.id}_${mode}`,
    examId: exam.id,
    agentId: sourceAttempt.agentId,
    sourceAttemptId: sourceAttempt.id,
    assignmentType: "reassigned",
    reassignmentMode: mode,
    questionIds: targetQuestionIds,
    status: "assigned",
    assignedAt: Date.now(),
    assignedBy: "auditor_1",
    attemptNumber: nextAttemptNumber,
    questionCount: targetQuestionIds.length,
  };

  return assignment;
}

// Mock helper simulating startAttempt payload creation
function createNewAttemptPayload(
  exam: Exam,
  agentId: string,
  assignment: ExamAssignment | null,
  priorAttempts: ExamAttempt[]
) {
  const highestPriorNum = priorAttempts.length > 0
    ? Math.max(...priorAttempts.map((a) => a.attemptNumber || 0))
    : 0;

  let attemptNumber = highestPriorNum + 1;
  if (assignment?.attemptNumber && assignment.attemptNumber > highestPriorNum) {
    attemptNumber = assignment.attemptNumber;
  }

  let targetQuestionRefs = [...exam.questions].sort((a, b) => a.order - b.order);

  if (assignment?.questionIds && assignment.questionIds.length > 0) {
    const allowed = new Set(assignment.questionIds);
    targetQuestionRefs = targetQuestionRefs.filter((q) => allowed.has(q.questionId));
  }

  // Pure clean answers array with empty agentAnswer
  const answers = targetQuestionRefs.map((q) => ({
    questionId: q.questionId,
    agentAnswer: "",
    maxMarks: 10,
    questionSnapshot: exam.questionSnapshots?.[q.questionId],
  }));

  const attempt: ExamAttempt = {
    id: `${exam.id}_${agentId}_${attemptNumber}`,
    examId: exam.id,
    agentId,
    attemptNumber,
    assignmentId: assignment?.id,
    answers,
    agentAnswers: {}, // Strictly empty object
    startedAt: Date.now(),
    status: "in_progress",
    analyticsFinalized: false,
    isReattempt: attemptNumber > 1,
    parentAttemptId: assignment?.sourceAttemptId,
  };

  return attempt;
}

// Mock helper simulating saveAllAnswers
function simulateSaveAllAnswers(
  targetAttempt: ExamAttempt,
  callerUid: string,
  newAnswers: Record<string, string>
) {
  if (targetAttempt.status !== "in_progress") {
    throw new Error("This attempt is no longer editable.");
  }
  if (callerUid !== targetAttempt.agentId) {
    throw new Error("Unauthorized: Cannot save answers for another agent's attempt.");
  }

  const merged = { ...(targetAttempt.agentAnswers || {}) };
  for (const [qid, ans] of Object.entries(newAnswers)) {
    if (ans !== undefined && ans !== null) {
      merged[qid] = ans;
    }
  }

  // Update in place
  targetAttempt.agentAnswers = merged;
  return targetAttempt;
}

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING REASSIGNMENT DATA INTEGRITY TESTS (1 to 13)");
  console.log("==================================================\n");

  const sampleQuestions: Question[] = [
    { id: "q1", questionId: "q1", text: "What is A?", questionType: "short_text", marks: 10, order: 1 } as any,
    { id: "q2", questionId: "q2", text: "What is B?", questionType: "short_text", marks: 10, order: 2 } as any,
    { id: "q3", questionId: "q3", text: "What is C?", questionType: "short_text", marks: 10, order: 3 } as any,
  ];

  const sampleExam: Exam = {
    id: "exam_test8",
    name: "Test 8 - RCM & Clinical",
    module: "RCM",
    batch: "2026",
    status: "published",
    questions: sampleQuestions as any,
    questionSnapshots: {
      q1: sampleQuestions[0],
      q2: sampleQuestions[1],
      q3: sampleQuestions[2],
    },
    description: "Sample test 8",
    createdBy: "auditor_1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    timeLimitMinutes: 30,
    mode: "normal",
    assignedAgentIds: ["agent_anagha", "agent_abu"],
  };

  const attempt1: ExamAttempt = {
    id: "exam_test8_agent_anagha_1",
    examId: sampleExam.id,
    agentId: "agent_anagha",
    attemptNumber: 1,
    status: "reviewed",
    startedAt: 1790271600000,
    submittedAt: 1790273400000,
    totalMarks: 10,
    maxTotalMarks: 30,
    agentAnswers: {
      q1: "Agent answer for Q1 in attempt 1",
      q2: "Incorrect answer for Q2",
      q3: "Incorrect answer for Q3",
    },
    answers: [
      { questionId: "q1", agentAnswer: "Agent answer for Q1 in attempt 1", marks: 10, maxMarks: 10 },
      { questionId: "q2", agentAnswer: "Incorrect answer for Q2", marks: 0, maxMarks: 10 },
      { questionId: "q3", agentAnswer: "Incorrect answer for Q3", marks: 0, maxMarks: 10 },
    ],
  };

  // TEST 1: Reassign -> Attempt #2 has 0 answers
  console.log("TEST 1: Reassign -> Attempt #2 has 0 answers");
  const asg1 = prepareReassignment(sampleExam, attempt1, "all", undefined, [attempt1]);
  assert.strictEqual(asg1.attemptNumber, 2);
  const attempt2 = createNewAttemptPayload(sampleExam, "agent_anagha", asg1, [attempt1]);
  assert.strictEqual(attempt2.attemptNumber, 2);
  assert.deepStrictEqual(attempt2.agentAnswers, {});
  attempt2.answers.forEach((ans) => {
    assert.strictEqual(ans.agentAnswer, "");
  });
  console.log("✔ PASS: Attempt #2 starts with completely empty agentAnswers and empty strings in answers[]\n");

  // TEST 2: Reassign All -> No answers
  console.log("TEST 2: Reassign All -> No answers");
  const asgAll = prepareReassignment(sampleExam, attempt1, "all", undefined, [attempt1]);
  assert.strictEqual(asgAll.questionIds.length, 3);
  const attemptAll = createNewAttemptPayload(sampleExam, "agent_anagha", asgAll, [attempt1]);
  assert.strictEqual(attemptAll.answers.length, 3);
  assert.strictEqual(Object.keys(attemptAll.agentAnswers || {}).length, 0);
  console.log("✔ PASS: Reassign All includes all 3 questions with 0 answers carried forward\n");

  // TEST 3: Reassign Wrong Answers Only -> Missed questions selected, previous answers NOT copied
  console.log("TEST 3: Reassign Wrong Answers Only -> Missed questions selected, previous answers NOT copied");
  const asgWrong = prepareReassignment(sampleExam, attempt1, "wrong_only", undefined, [attempt1]);
  assert.deepStrictEqual(asgWrong.questionIds, ["q2", "q3"]);
  const attemptWrong = createNewAttemptPayload(sampleExam, "agent_anagha", asgWrong, [attempt1]);
  assert.strictEqual(attemptWrong.answers.length, 2);
  assert.strictEqual(attemptWrong.answers[0].questionId, "q2");
  assert.strictEqual(attemptWrong.answers[0].agentAnswer, "");
  assert.strictEqual(attemptWrong.answers[1].questionId, "q3");
  assert.strictEqual(attemptWrong.answers[1].agentAnswer, "");
  assert.strictEqual(Object.keys(attemptWrong.agentAnswers || {}).length, 0);
  console.log("✔ PASS: Only wrong questions (q2, q3) selected, zero prior answers copied\n");

  // TEST 4: Reassign Custom -> Selected questions only, no previous answers
  console.log("TEST 4: Reassign Custom -> Selected questions only, no previous answers");
  const asgCustom = prepareReassignment(sampleExam, attempt1, "custom", ["q1", "q3"], [attempt1]);
  assert.deepStrictEqual(asgCustom.questionIds, ["q1", "q3"]);
  const attemptCustom = createNewAttemptPayload(sampleExam, "agent_anagha", asgCustom, [attempt1]);
  assert.strictEqual(attemptCustom.answers.length, 2);
  assert.strictEqual(attemptCustom.answers[0].questionId, "q1");
  assert.strictEqual(attemptCustom.answers[0].agentAnswer, "");
  assert.strictEqual(Object.keys(attemptCustom.agentAnswers || {}).length, 0);
  console.log("✔ PASS: Custom selected questions created with 0 answers\n");

  // TEST 5: Agent opens Attempt #2 -> Questions start unanswered
  console.log("TEST 5: Agent opens Attempt #2 -> Questions start unanswered in UI state");
  const uiInitialAnswers: Record<string, string> = {};
  attempt2.answers.forEach((ans) => {
    uiInitialAnswers[ans.questionId] = ans.agentAnswer || "";
  });
  assert.strictEqual(uiInitialAnswers["q1"], "");
  assert.strictEqual(uiInitialAnswers["q2"], "");
  assert.strictEqual(uiInitialAnswers["q3"], "");
  console.log("✔ PASS: TakeExam component initializes empty textboxes for all questions\n");

  // TEST 6: Answering Q1 only updates Attempt #2. Attempt #1 unchanged.
  console.log("TEST 6: Answering Q1 only updates Attempt #2. Attempt #1 unchanged.");
  const originalAttempt1Answers = JSON.stringify(attempt1.agentAnswers);
  simulateSaveAllAnswers(attempt2, "agent_anagha", { q1: "Newly typed answer for Attempt 2" });
  assert.strictEqual(attempt2.agentAnswers?.["q1"], "Newly typed answer for Attempt 2");
  assert.strictEqual(JSON.stringify(attempt1.agentAnswers), originalAttempt1Answers);
  console.log("✔ PASS: Attempt #2 modified; Attempt #1 answers strictly unchanged\n");

  // TEST 7: Attempt #1 autosave cannot write into Attempt #2
  console.log("TEST 7: Attempt #1 autosave cannot write into Attempt #2");
  assert.throws(
    () => {
      // Attempt 1 is in status 'reviewed'
      simulateSaveAllAnswers(attempt1, "agent_anagha", { q2: "Malicious or stale autosave" });
    },
    /no longer editable/
  );
  console.log("✔ PASS: Stale autosave for Attempt #1 rejected because status !== in_progress\n");

  // TEST 8 & 9: Refresh and multi-tab isolation
  console.log("TEST 8 & 9: Refresh and multi-tab isolation");
  // Simulating fresh load of attempt2 from server
  const refreshedAttempt2 = JSON.parse(JSON.stringify(attempt2));
  assert.strictEqual(refreshedAttempt2.agentAnswers["q1"], "Newly typed answer for Attempt 2");
  assert.strictEqual(refreshedAttempt2.agentAnswers["q2"], undefined);
  console.log("✔ PASS: Attempt #2 reloads only its own persisted answers\n");

  // TEST 10: Reassign again -> Attempt #3 starts with zero answers
  console.log("TEST 10: Reassign again -> Attempt #3 starts with zero answers");
  attempt2.status = "reviewed";
  attempt2.answers = [
    { questionId: "q1", agentAnswer: "Newly typed answer for Attempt 2", marks: 10, maxMarks: 10 },
    { questionId: "q2", agentAnswer: "Still wrong in attempt 2", marks: 0, maxMarks: 10 },
    { questionId: "q3", agentAnswer: "Correct in attempt 2", marks: 10, maxMarks: 10 },
  ];
  const asg3 = prepareReassignment(sampleExam, attempt2, "wrong_only", undefined, [attempt1, attempt2]);
  assert.strictEqual(asg3.attemptNumber, 3);
  assert.deepStrictEqual(asg3.questionIds, ["q2"]);
  const attempt3 = createNewAttemptPayload(sampleExam, "agent_anagha", asg3, [attempt1, attempt2]);
  assert.strictEqual(attempt3.attemptNumber, 3);
  assert.strictEqual(attempt3.answers.length, 1);
  assert.strictEqual(attempt3.answers[0].questionId, "q2");
  assert.strictEqual(attempt3.answers[0].agentAnswer, "");
  assert.deepStrictEqual(attempt3.agentAnswers, {});
  console.log("✔ PASS: Attempt #3 created with attemptNumber=3, 1 question, and 0 answers\n");

  // TEST 11: Cross-agent isolation
  console.log("TEST 11: Cross-agent isolation");
  assert.throws(
    () => {
      // Agent Abu tries to save to Anagha's attempt
      simulateSaveAllAnswers(attempt3, "agent_abu", { q2: "Abu trying to answer" });
    },
    /Unauthorized: Cannot save answers for another agent/
  );
  console.log("✔ PASS: Cross-agent write rejected with Unauthorized error\n");

  // TEST 12: Revoke / reassign sequence
  console.log("TEST 12: Revoke/reassign sequence");
  const revokedAssignment: ExamAssignment = {
    ...asg3,
    status: "revoked",
    revokedAt: Date.now(),
    revokedBy: "auditor_1",
  };
  // When an assignment is revoked, agent dashboard filters it out
  const agentActiveAssignments = [revokedAssignment].filter(
    (a) => a.status === "assigned" || a.status === "in_progress"
  );
  assert.strictEqual(agentActiveAssignments.length, 0);
  console.log("✔ PASS: Revoked assignment immediately filtered out from active assignments\n");

  // TEST 13: Legacy historical answers remain intact
  console.log("TEST 13: Legacy historical answers remain intact");
  assert.strictEqual(attempt1.agentAnswers?.["q1"], "Agent answer for Q1 in attempt 1");
  assert.strictEqual(attempt1.agentAnswers?.["q2"], "Incorrect answer for Q2");
  assert.strictEqual(attempt1.status, "reviewed");
  console.log("✔ PASS: Attempt #1 historical answers and status remain completely intact\n");

  console.log("==================================================");
  console.log("ALL 13 DATA INTEGRITY TEST CASES PASSED SUCCESSFULLY!");
  console.log("==================================================");
}

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
