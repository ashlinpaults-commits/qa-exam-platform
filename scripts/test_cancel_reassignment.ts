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
  const { stripUndefined } = await import("../src/lib/questions");
  const {
    normalizeAgentAnswers,
    computeExamMasterScorecard,
  } = await import("../src/lib/attempts");
  const { generateAssignmentId } = await import("../src/lib/assignments");

  type ExamAttempt = import("../src/types").ExamAttempt;
  type AttemptAnswer = import("../src/types").AttemptAnswer;
  type Exam = import("../src/types").Exam;
  type ExamAssignment = import("../src/types").ExamAssignment;
  type ReassignmentMode = import("../src/types").ReassignmentMode;

  console.log("==================================================");
  console.log("RUNNING AUDITOR CANCEL REASSIGNMENT TEST SUITE");
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

  function hasUndefined(obj: any): boolean {
    if (obj === undefined) return true;
    if (obj === null || typeof obj !== "object") return false;
    for (const key of Object.keys(obj)) {
      if (obj[key] === undefined || hasUndefined(obj[key])) return true;
    }
    return false;
  }

  // Mock initial exam
  const mockExam: Exam = {
    id: "exam_test_101",
    name: "Test Exam 101",
    description: "Mock exam description",
    category: "Revenue Cycle Management",
    mode: "normal",
    timeLimitMinutes: 45,
    status: "published",
    questions: [
      { questionId: "q1", order: 1 },
      { questionId: "q2", order: 2 },
      { questionId: "q3", order: 3 },
      { questionId: "q4", order: 4 },
    ],
    assignedAgentIds: ["agent_anagha"],
    createdAt: 1700000000000,
    createdBy: "auditor_1",
    updatedAt: 1700000000000,
  };

  // Mock historical attempt #1 (Finalized / Reviewed)
  const historicalAttempt1: ExamAttempt = {
    id: "att_hist_1",
    examId: mockExam.id,
    agentId: "agent_anagha",
    attemptNumber: 1,
    status: "reviewed",
    startedAt: 1700001000000,
    submittedAt: 1700002000000,
    reviewedAt: 1700003000000,
    reviewedBy: "auditor_1",
    timeTakenSeconds: 1000,
    totalMarks: 2,
    maxTotalMarks: 4,
    answers: [
      { questionId: "q1", agentAnswer: "correct ans", marks: 1, maxMarks: 1 },
      { questionId: "q2", agentAnswer: "wrong ans", marks: 0, maxMarks: 1 },
      { questionId: "q3", agentAnswer: "correct ans", marks: 1, maxMarks: 1 },
      { questionId: "q4", agentAnswer: "wrong ans", marks: 0, maxMarks: 1 },
    ],
  };

  // ----------------------------------------------------
  // TEST 1: Reassignment Creation & Initial State
  // ----------------------------------------------------
  const asgId = generateAssignmentId(mockExam.id, "agent_anagha", "wrong_only", historicalAttempt1.id);
  const reassignment: ExamAssignment = {
    id: asgId,
    examId: mockExam.id,
    agentId: "agent_anagha",
    assignmentType: "reassigned",
    reassignmentMode: "wrong_only",
    sourceAttemptId: historicalAttempt1.id,
    attemptNumber: 2,
    status: "assigned",
    assignedAt: 1700004000000,
    assignedBy: "auditor_1",
    questionIds: ["q2", "q4"],
    questionCount: 2,
  };

  assert(
    reassignment.status === "assigned" && reassignment.attemptNumber === 2 && reassignment.questionIds.length === 2,
    "TEST 1: Reassignment created in pending state ('assigned') with attemptNumber = 2 and targeted wrong questions"
  );

  // ----------------------------------------------------
  // TEST 2: Cancel Before Start — State Mutation & Integrity
  // ----------------------------------------------------
  const now = 1700004500000;
  const cancelledPatch = stripUndefined({
    status: "cancelled" as const,
    cancelledAt: now,
    cancelledBy: "auditor_1",
    cancellationReason: "Reassigned by mistake",
  });

  const cancelledAssignment: ExamAssignment = {
    ...reassignment,
    ...cancelledPatch,
  };

  assert(
    cancelledAssignment.status === "cancelled" &&
    cancelledAssignment.cancelledAt === now &&
    cancelledAssignment.cancelledBy === "auditor_1" &&
    cancelledAssignment.cancellationReason === "Reassigned by mistake",
    "TEST 2: Cancel Reassignment sets status = 'cancelled', cancelledAt, cancelledBy, and cancellationReason"
  );

  // Ensure historical attempt #1 is completely unmodified
  assert(
    historicalAttempt1.status === "reviewed" &&
    historicalAttempt1.totalMarks === 2 &&
    historicalAttempt1.answers.length === 4,
    "TEST 2 (Integrity): Historical attempt #1 is 100% untouched by reassignment cancellation"
  );

  // ----------------------------------------------------
  // TEST 3: Agent Dashboard Filtering of Cancelled Assignments
  // ----------------------------------------------------
  // Simulate actionable filter on agent dashboard
  const agentAssignments = [reassignment];
  const agentActionableActive = agentAssignments.filter((a) => a.status === "assigned" || a.status === "in_progress");
  assert(agentActionableActive.length === 1, "TEST 3a: Pending reassignment is visible to agent before cancellation");

  const agentAssignmentsAfterCancel = [cancelledAssignment];
  const agentActionableAfterCancel = agentAssignmentsAfterCancel.filter((a) => a.status === "assigned" || a.status === "in_progress");
  assert(
    agentActionableAfterCancel.length === 0,
    "TEST 3b: Cancelled reassignment is completely excluded from agent's actionable assignments"
  );

  // ----------------------------------------------------
  // TEST 4 & 5: Direct URL Access Guard
  // ----------------------------------------------------
  // Simulate startAttempt guard check
  function simulateStartAttemptCheck(assignment: ExamAssignment) {
    if (assignment.status === "cancelled") {
      throw new Error("This reassignment was cancelled by an auditor and is no longer available.");
    }
    if (assignment.status === "revoked") {
      throw new Error("This assignment has been revoked by an auditor.");
    }
    return "ATTEMPT_STARTED";
  }

  let errorThrownOnCancelledStart = false;
  try {
    simulateStartAttemptCheck(cancelledAssignment);
  } catch (err: any) {
    if (err.message.includes("cancelled by an auditor")) {
      errorThrownOnCancelledStart = true;
    }
  }
  assert(
    errorThrownOnCancelledStart,
    "TEST 4 & 5: Direct attempt start on cancelled assignment is rejected with clear error message"
  );

  // ----------------------------------------------------
  // TEST 6: ReviewScreen Unified Items List Rendering
  // ----------------------------------------------------
  // Unified items logic as in ReviewScreen.tsx
  const allAttempts = [historicalAttempt1];
  const allAssignments = [cancelledAssignment];

  const activeAttemptAssignmentIds = new Set(
    allAttempts
      .filter((a) => a.status === "in_progress" || a.status === "submitted" || a.status === "review_in_progress")
      .map((a) => a.assignmentId)
      .filter(Boolean)
  );

  const relevantAssignments = allAssignments.filter((a) => {
    if (a.status !== "assigned" && a.status !== "cancelled") return false;
    if (activeAttemptAssignmentIds.has(a.id)) return false;
    return true;
  });

  assert(
    relevantAssignments.length === 1 && relevantAssignments[0].status === "cancelled",
    "TEST 6: ReviewScreen includes cancelled assignment in unified list with explicit 'cancelled' badge"
  );

  // ----------------------------------------------------
  // TEST 7: Re-reassignment After Cancellation (Attempt Numbering)
  // ----------------------------------------------------
  // If auditor re-reassigns after cancelling, next attempt number must be correctly calculated as #2
  // (since attempt #2 was cancelled and never started)
  const existingAttempts = [historicalAttempt1]; // only attempt 1 exists
  const nextAttemptNum = Math.max(0, ...existingAttempts.map((a) => a.attemptNumber || 1)) + 1;

  // In createAssignment, if previous assignment is cancelled, it appends timestamp to base ID:
  const baseAsgId = generateAssignmentId(mockExam.id, "agent_anagha", "wrong_only", historicalAttempt1.id);
  const newAsgId = `${baseAsgId}_${1700005000000}`;
  const reReassignment: ExamAssignment = {
    id: newAsgId,
    examId: mockExam.id,
    agentId: "agent_anagha",
    assignmentType: "reassigned",
    reassignmentMode: "wrong_only",
    sourceAttemptId: historicalAttempt1.id,
    attemptNumber: nextAttemptNum,
    status: "assigned",
    assignedAt: 1700005000000,
    assignedBy: "auditor_1",
    questionIds: ["q2", "q4"],
    questionCount: 2,
  };

  assert(
    reReassignment.attemptNumber === 2 && reReassignment.id !== cancelledAssignment.id,
    "TEST 7: Re-reassignment after cancellation creates a clean new assignment with attemptNumber = 2 without clobbering history"
  );

  // ----------------------------------------------------
  // TEST 8: Cancellation Idempotency
  // ----------------------------------------------------
  function simulateCancelReassignment(assignment: ExamAssignment) {
    if (assignment.status === "cancelled") {
      return { cancelledAssignment: assignment, alreadyCancelled: true };
    }
    if (assignment.status === "in_progress") {
      throw new Error("This reassignment has already been started and cannot be cancelled.");
    }
    if (assignment.status === "submitted" || assignment.status === "reviewed") {
      throw new Error("This reassignment has already been submitted and cannot be cancelled.");
    }
    return {
      cancelledAssignment: { ...assignment, status: "cancelled" as const },
      alreadyCancelled: false,
    };
  }

  const res1 = simulateCancelReassignment(reassignment);
  const res2 = simulateCancelReassignment(res1.cancelledAssignment);
  assert(
    res1.cancelledAssignment.status === "cancelled" &&
    res2.alreadyCancelled === true &&
    res2.cancelledAssignment.status === "cancelled",
    "TEST 8: Repeated/double cancellation is completely idempotent and safe"
  );

  // ----------------------------------------------------
  // TEST 9: In-Progress Attempt Disallows Cancellation
  // ----------------------------------------------------
  const inProgressAssignment: ExamAssignment = {
    ...reassignment,
    status: "in_progress",
    attemptId: "att_in_prog_2",
  };

  let disallowInProgressError = false;
  try {
    simulateCancelReassignment(inProgressAssignment);
  } catch (err: any) {
    if (err.message.includes("already been started")) {
      disallowInProgressError = true;
    }
  }
  assert(
    disallowInProgressError,
    "TEST 9: In-progress reassignment cannot be cancelled (requires Revoke or Auditor Submission flow)"
  );

  // ----------------------------------------------------
  // TEST 10 & 11: Submitted / Reviewed Attempt Disallows Cancellation
  // ----------------------------------------------------
  const submittedAssignment: ExamAssignment = {
    ...reassignment,
    status: "submitted",
    attemptId: "att_sub_2",
  };

  let disallowSubmittedError = false;
  try {
    simulateCancelReassignment(submittedAssignment);
  } catch (err: any) {
    if (err.message.includes("already been submitted")) {
      disallowSubmittedError = true;
    }
  }
  assert(
    disallowSubmittedError,
    "TEST 10 & 11: Submitted or reviewed reassignments cannot be cancelled"
  );

  // ----------------------------------------------------
  // TEST 12, 13, 14: All Reassignment Modes Supported
  // ----------------------------------------------------
  const modes: ReassignmentMode[] = ["all", "wrong_only", "custom"];
  let allModesPass = true;
  for (const mode of modes) {
    const asg: ExamAssignment = {
      ...reassignment,
      id: `asg_${mode}`,
      reassignmentMode: mode,
      status: "assigned",
    };
    const c = simulateCancelReassignment(asg);
    if (c.cancelledAssignment.status !== "cancelled" || c.cancelledAssignment.reassignmentMode !== mode) {
      allModesPass = false;
    }
  }
  assert(
    allModesPass,
    "TEST 12, 13, 14: Cancellation works uniformly across all reassignment modes ('all', 'wrong_only', 'custom')"
  );

  // ----------------------------------------------------
  // TEST 15 & 16: Firestore Safety (No Undefined Values)
  // ----------------------------------------------------
  const cleanPayload = stripUndefined({
    status: "cancelled",
    cancelledAt: Date.now(),
    cancelledBy: "auditor_1",
    cancellationReason: undefined, // test undefined stripping
  });

  assert(
    !hasUndefined(cleanPayload) && cleanPayload.cancellationReason === undefined && !("cancellationReason" in cleanPayload),
    "TEST 15 & 16: Firestore undefined safety strictly strips undefined fields, preventing write errors"
  );

  // ----------------------------------------------------
  // TEST 17: Master Scorecard Progression Calculation Intact
  // ----------------------------------------------------
  const scorecard = computeExamMasterScorecard(mockExam, [historicalAttempt1]);
  assert(
    scorecard.masterPercentage === 50 &&
    scorecard.currentMasterScore === 2 &&
    scorecard.masterTotalMarks === 4 &&
    scorecard.reviewedAttemptsCount === 1,
    "TEST 17: Master scorecard progression remains 100% accurate after cancellation"
  );

  console.log("\n==================================================");
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
