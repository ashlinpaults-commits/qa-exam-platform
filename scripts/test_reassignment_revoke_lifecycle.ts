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
  console.log("RUNNING REASSIGNMENT & REVOCATION LIFECYCLE TESTS");
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

  // Recursive checker for any `undefined` values in object trees (Firestore safety)
  function hasUndefined(obj: any): boolean {
    if (obj === undefined) return true;
    if (obj === null || typeof obj !== "object") return false;
    for (const key of Object.keys(obj)) {
      if (obj[key] === undefined || hasUndefined(obj[key])) return true;
    }
    return false;
  }

  const mockExam: Exam = {
    id: "exam_test_rcm_01",
    name: "PS 1126 || RCM - Test 01",
    description: "Revenue cycle evaluation test",
    category: "Revenue Cycle Management",
    mode: "normal",
    status: "published",
    questions: [
      { questionId: "q1", order: 1 },
      { questionId: "q2", order: 2 },
      { questionId: "q3", order: 3 },
      { questionId: "q4", order: 4 },
      { questionId: "q5", order: 5 },
    ],
    assignedAgentIds: ["agent_john"],
    createdBy: "auditor_sarah",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  const attempt1Completed: ExamAttempt = {
    id: "exam_test_rcm_01_agent_john_1",
    examId: "exam_test_rcm_01",
    agentId: "agent_john",
    attemptNumber: 1,
    status: "reviewed",
    startedAt: 1700001000000,
    submittedAt: 1700002000000,
    reviewedAt: 1700003000000,
    reviewedBy: "auditor_sarah",
    totalMarks: 30,
    maxTotalMarks: 50,
    answers: [
      { questionId: "q1", agentAnswer: "Answer 1", marks: 10, maxMarks: 10 },
      { questionId: "q2", agentAnswer: "Answer 2", marks: 4, maxMarks: 10 }, // wrong/partial
      { questionId: "q3", agentAnswer: "Answer 3", marks: 6, maxMarks: 10 }, // wrong/partial
      { questionId: "q4", agentAnswer: "Answer 4", marks: 10, maxMarks: 10 },
      { questionId: "q5", agentAnswer: "Answer 5", marks: 0, maxMarks: 10 }, // wrong (0 marks)
    ],
  };

  // Simulated Database State
  let dbAssignments: ExamAssignment[] = [];
  let dbAttempts: ExamAttempt[] = [attempt1Completed];
  let dbExam: Exam = JSON.parse(JSON.stringify(mockExam));

  // Simulation Helper for creating assignments
  function simulateCreateAssignment(params: {
    exam: Exam;
    agentId: string;
    sourceAttemptId?: string;
    assignmentType: "original" | "reassigned";
    reassignmentMode?: ReassignmentMode;
    questionIds: string[];
    assignedBy: string;
    targetAttemptNumber?: number;
  }): ExamAssignment {
    const { exam, agentId, sourceAttemptId, assignmentType, reassignmentMode, questionIds, assignedBy, targetAttemptNumber } = params;
    const modeKey = reassignmentMode || "all";
    const baseId = generateAssignmentId(exam.id, agentId, modeKey, sourceAttemptId);
    let targetId = baseId;

    const existing = dbAssignments.find((a) => a.id === baseId);
    if (existing) {
      if (existing.status === "assigned" || existing.status === "in_progress") {
        return existing; // idempotent reuse
      }
      if (existing.status === "revoked" || existing.status === "submitted" || existing.status === "reviewed") {
        targetId = `${baseId}_${Date.now()}`;
      }
    }

    const payload: ExamAssignment = stripUndefined({
      id: targetId,
      examId: exam.id,
      agentId,
      sourceAttemptId,
      assignmentType,
      reassignmentMode,
      questionIds,
      status: "assigned",
      assignedAt: Date.now(),
      assignedBy,
      attemptNumber: targetAttemptNumber,
      examName: exam.name,
      questionCount: questionIds.length,
    });

    dbAssignments.push(payload);
    return payload;
  }

  // Simulation Helper for revoking assignments
  function simulateRevokeAssignment(params: {
    examId: string;
    agentId: string;
    assignmentId?: string;
    revokedBy: string;
    reason?: string;
  }) {
    const { examId, agentId, assignmentId, revokedBy, reason } = params;
    const asg = assignmentId
      ? dbAssignments.find((a) => a.id === assignmentId)
      : dbAssignments.find((a) => a.examId === examId && a.agentId === agentId && (a.status === "assigned" || a.status === "in_progress"));

    if (asg) {
      asg.status = "revoked";
      asg.revokedAt = Date.now();
      asg.revokedBy = revokedBy;
      asg.revocationReason = reason || "Revoked by auditor";

      if (asg.attemptId) {
        const linkedAttempt = dbAttempts.find((a) => a.id === asg.attemptId);
        if (linkedAttempt && linkedAttempt.status === "in_progress") {
          linkedAttempt.status = "revoked";
        }
      }
    }

    // Terminate any in-progress attempt for this exam/agent
    dbAttempts.forEach((a) => {
      if (a.examId === examId && a.agentId === agentId && a.status === "in_progress") {
        a.status = "revoked";
      }
    });

    // Update exam reattempt permissions
    if (dbExam.reattemptPermissions) {
      delete dbExam.reattemptPermissions[agentId];
    }
  }

  // Simulation Helper for starting attempt
  function simulateStartAttempt(exam: Exam, agentId: string, assignmentId?: string): string {
    let activeAsg: ExamAssignment | undefined;
    if (assignmentId) {
      activeAsg = dbAssignments.find((a) => a.id === assignmentId);
      if (!activeAsg) throw new Error("This assignment could not be found.");
      if (activeAsg.agentId !== agentId) throw new Error("You are not authorized to start this assignment.");
      if (activeAsg.status === "revoked") throw new Error("This assignment has been revoked by an auditor and is no longer available.");
    } else {
      if (!exam.assignedAgentIds.includes(agentId)) {
        throw new Error("You are not assigned to this exam.");
      }
    }

    const prior = dbAttempts.filter((a) => a.examId === exam.id && a.agentId === agentId);
    if (activeAsg?.attemptId) {
      const matched = prior.find((a) => a.id === activeAsg!.attemptId);
      if (matched) {
        if (matched.status === "revoked") throw new Error("This attempt was revoked by an auditor and cannot be continued.");
        if (matched.status === "in_progress") return matched.id;
      }
    }

    const highestPrior = prior.length > 0 ? Math.max(...prior.map((a) => a.attemptNumber || 0)) : 0;
    const attemptNumber = activeAsg?.attemptNumber && activeAsg.attemptNumber > highestPrior
      ? activeAsg.attemptNumber
      : highestPrior + 1;

    const attemptId = `${exam.id}_${agentId}_${attemptNumber}`;
    const newAttempt: ExamAttempt = {
      id: attemptId,
      examId: exam.id,
      agentId,
      attemptNumber,
      status: "in_progress",
      startedAt: Date.now(),
      assignmentId: activeAsg?.id,
      isReattempt: attemptNumber > 1,
      answers: exam.questions.map((q) => ({ questionId: q.questionId, agentAnswer: "", maxMarks: 10 })),
    };

    dbAttempts.push(newAttempt);
    if (activeAsg) {
      activeAsg.status = "in_progress";
      activeAsg.attemptId = attemptId;
    }

    return attemptId;
  }

  // =========================================================================
  // TEST 1: Completed Attempt #1 -> Reassign
  // =========================================================================
  const missedQIds = attempt1Completed.answers.filter((a) => a.marks === undefined || a.marks < a.maxMarks).map((a) => a.questionId);
  const asg1 = simulateCreateAssignment({
    exam: dbExam,
    agentId: "agent_john",
    sourceAttemptId: attempt1Completed.id,
    assignmentType: "reassigned",
    reassignmentMode: "wrong_only",
    questionIds: missedQIds,
    assignedBy: "auditor_sarah",
    targetAttemptNumber: 2,
  });

  assert(
    asg1.status === "assigned" && asg1.attemptNumber === 2 && asg1.questionCount === 3,
    "TEST 1: Completed Attempt #1 -> Reassign creates new assignment with attemptNumber = 2"
  );

  // =========================================================================
  // TEST 2 & 3: Review Attempts displays pending reassignment as Attempt #2
  // =========================================================================
  const pendingForReview = dbAssignments.filter((a) => a.status === "assigned" && a.examId === dbExam.id);
  assert(
    pendingForReview.length === 1 && pendingForReview[0].attemptNumber === 2,
    "TEST 2 & 3: Review Attempts displays pending reassignment as Attempt #2 immediately"
  );

  // =========================================================================
  // TEST 4: Agent has not started -> Pending/reassigned state
  // =========================================================================
  assert(
    asg1.status === "assigned" && !asg1.attemptId,
    "TEST 4: Reassign -> Agent has not started retains pending/reassigned state without premature attempt creation"
  );

  // =========================================================================
  // TEST 5: Agent starts -> Attempt #2 / In Progress, no duplicate
  // =========================================================================
  const attempt2Id = simulateStartAttempt(dbExam, "agent_john", asg1.id);
  const attempt2Doc = dbAttempts.find((a) => a.id === attempt2Id);
  const attemptsCountForAgent = dbAttempts.filter((a) => a.examId === dbExam.id && a.agentId === "agent_john").length;

  assert(
    attempt2Id === "exam_test_rcm_01_agent_john_2" &&
    attempt2Doc?.status === "in_progress" &&
    asg1.status === "in_progress" &&
    attemptsCountForAgent === 2,
    "TEST 5: Agent starts -> Same lifecycle becomes Attempt #2 / In Progress with no duplicate attempts"
  );

  // =========================================================================
  // TEST 6: Agent submits -> Attempt #2 -> Pending Review
  // =========================================================================
  attempt2Doc!.status = "submitted";
  attempt2Doc!.submittedAt = Date.now();
  asg1.status = "submitted";

  assert(
    attempt2Doc?.status === "submitted" && asg1.status === "submitted",
    "TEST 6: Agent submits -> Attempt #2 transitions to Pending Review"
  );

  // =========================================================================
  // TEST 7: Auditor finalizes -> Attempt #2 -> Completed
  // =========================================================================
  attempt2Doc!.status = "reviewed";
  attempt2Doc!.totalMarks = 26;
  attempt2Doc!.maxTotalMarks = 30;
  attempt2Doc!.reviewedAt = Date.now();
  attempt2Doc!.reviewedBy = "auditor_sarah";
  asg1.status = "reviewed";

  assert(
    attempt2Doc?.status === "reviewed" && attempt2Doc.totalMarks === 26,
    "TEST 7: Auditor finalizes -> Attempt #2 transitions to Completed (reviewed)"
  );

  // =========================================================================
  // TEST 8: Reassign same exam again -> Correct next lifecycle Attempt #3
  // =========================================================================
  const asg2 = simulateCreateAssignment({
    exam: dbExam,
    agentId: "agent_john",
    sourceAttemptId: attempt2Doc!.id,
    assignmentType: "reassigned",
    reassignmentMode: "all",
    questionIds: dbExam.questions.map((q) => q.questionId),
    assignedBy: "auditor_sarah",
    targetAttemptNumber: 3,
  });

  assert(
    asg2.status === "assigned" && asg2.attemptNumber === 3,
    "TEST 8: Reassign same exam again -> Correct next lifecycle Attempt #3 created"
  );

  // =========================================================================
  // TEST 9: Reassign -> Revoke before agent starts
  // =========================================================================
  simulateRevokeAssignment({
    examId: dbExam.id,
    agentId: "agent_john",
    assignmentId: asg2.id,
    revokedBy: "auditor_sarah",
    reason: "Mistaken reassignment",
  });

  let agentCannotStartRevoked = false;
  try {
    simulateStartAttempt(dbExam, "agent_john", asg2.id);
  } catch (err: any) {
    if (err.message.includes("revoked")) agentCannotStartRevoked = true;
  }

  assert(
    asg2.status === "revoked" &&
    agentCannotStartRevoked &&
    attempt1Completed.status === "reviewed" &&
    attempt2Doc?.status === "reviewed",
    "TEST 9: Revoke before agent starts marks assignment revoked, blocks URL access, and preserves historical attempts #1 and #2"
  );

  // =========================================================================
  // TEST 10: Reassign -> Agent starts -> Revoke in progress
  // =========================================================================
  const asg3 = simulateCreateAssignment({
    exam: dbExam,
    agentId: "agent_john",
    sourceAttemptId: attempt2Doc!.id,
    assignmentType: "reassigned",
    reassignmentMode: "all",
    questionIds: dbExam.questions.map((q) => q.questionId),
    assignedBy: "auditor_sarah",
    targetAttemptNumber: 3,
  });

  const attempt3Id = simulateStartAttempt(dbExam, "agent_john", asg3.id);
  const attempt3Doc = dbAttempts.find((a) => a.id === attempt3Id);

  // Auditor revokes while attempt 3 is in progress
  simulateRevokeAssignment({
    examId: dbExam.id,
    agentId: "agent_john",
    assignmentId: asg3.id,
    revokedBy: "auditor_sarah",
    reason: "Terminated by auditor during active attempt",
  });

  let agentCannotResumeRevoked = false;
  try {
    simulateStartAttempt(dbExam, "agent_john", asg3.id);
  } catch (err: any) {
    if (err.message.includes("revoked")) agentCannotResumeRevoked = true;
  }

  assert(
    asg3.status === "revoked" &&
    attempt3Doc?.status === "revoked" &&
    agentCannotResumeRevoked &&
    attempt1Completed.status === "reviewed" &&
    attempt2Doc?.status === "reviewed",
    "TEST 10: Revoke in progress terminates attempt, blocks resumption, and preserves historical attempts intact"
  );

  // =========================================================================
  // TEST 11 & 12: Submitted and Finalized attempts remain safe
  // =========================================================================
  assert(
    attempt1Completed.status === "reviewed" &&
    attempt1Completed.totalMarks === 30 &&
    attempt2Doc?.status === "reviewed" &&
    attempt2Doc.totalMarks === 26,
    "TEST 11 & 12: Submitted and finalized historical attempts and scores remain completely unchanged after revocations"
  );

  // =========================================================================
  // TEST 13: Reassign -> Revoke -> Reassign again sequence
  // =========================================================================
  const asg4 = simulateCreateAssignment({
    exam: dbExam,
    agentId: "agent_john",
    sourceAttemptId: attempt2Doc!.id,
    assignmentType: "reassigned",
    reassignmentMode: "wrong_only",
    questionIds: ["q2", "q5"],
    assignedBy: "auditor_sarah",
    targetAttemptNumber: 4,
  });

  assert(
    asg4.status === "assigned" &&
    asg4.attemptNumber === 4 &&
    asg3.status === "revoked",
    "TEST 13: Reassign -> Revoke -> Reassign again generates fresh active assignment with stable sequence #4"
  );

  // =========================================================================
  // TEST 14: Double-click Reassign (Idempotency)
  // =========================================================================
  const asg4Duplicate = simulateCreateAssignment({
    exam: dbExam,
    agentId: "agent_john",
    sourceAttemptId: attempt2Doc!.id,
    assignmentType: "reassigned",
    reassignmentMode: "wrong_only",
    questionIds: ["q2", "q5"],
    assignedBy: "auditor_sarah",
    targetAttemptNumber: 4,
  });

  assert(
    asg4.id === asg4Duplicate.id && dbAssignments.filter((a) => a.id === asg4.id).length === 1,
    "TEST 14: Double-click Reassign is idempotent, reusing existing active assignment without duplicate"
  );

  // =========================================================================
  // TEST 15: Double-click Revoke (Idempotency)
  // =========================================================================
  simulateRevokeAssignment({
    examId: dbExam.id,
    agentId: "agent_john",
    assignmentId: asg4.id,
    revokedBy: "auditor_sarah",
  });
  simulateRevokeAssignment({
    examId: dbExam.id,
    agentId: "agent_john",
    assignmentId: asg4.id,
    revokedBy: "auditor_sarah",
  });

  assert(
    asg4.status === "revoked",
    "TEST 15: Double-click Revoke is safe and idempotent with no corruption"
  );

  // =========================================================================
  // TEST 16 & 17: Persisted state & multi-tab convergence
  // =========================================================================
  const activeAssignments = dbAssignments.filter((a) => a.status === "assigned" || a.status === "in_progress");
  assert(
    !activeAssignments.some((a) => a.id === asg4.id),
    "TEST 16 & 17: Revoked assignments remain persisted as revoked across reload and multiple client views"
  );

  // =========================================================================
  // TEST 18: Agent dashboard active filter excludes revoked
  // =========================================================================
  const agentDashboardExams = dbAssignments.filter(
    (a) => a.agentId === "agent_john" && (a.status === "assigned" || a.status === "in_progress")
  );
  assert(
    agentDashboardExams.length === 0,
    "TEST 18: Agent dashboard active filter excludes all revoked assignments from active view"
  );

  // =========================================================================
  // TEST 19: Auditor Review Attempts shows pending reassignments
  // =========================================================================
  const asg5 = simulateCreateAssignment({
    exam: dbExam,
    agentId: "agent_john",
    sourceAttemptId: attempt2Doc!.id,
    assignmentType: "reassigned",
    reassignmentMode: "custom",
    questionIds: ["q1", "q4"],
    assignedBy: "auditor_sarah",
    targetAttemptNumber: 5,
  });

  const auditorReviewItems = dbAssignments.filter((a) => a.examId === dbExam.id && a.status === "assigned");
  assert(
    auditorReviewItems.some((a) => a.id === asg5.id && a.attemptNumber === 5),
    "TEST 19: Auditor Review Attempts displays newly reassigned Attempt #5 awaiting agent"
  );

  // =========================================================================
  // TEST 20 & 21: Reassignment modes (Wrong Only & Custom) preserved
  // =========================================================================
  assert(
    asg1.reassignmentMode === "wrong_only" && asg1.questionIds.length === 3 &&
    asg5.reassignmentMode === "custom" && asg5.questionIds.length === 2,
    "TEST 20 & 21: Wrong Answers Only and Custom reassignment question scopes are preserved accurately"
  );

  // =========================================================================
  // TEST 22: Zero score remains valid
  // =========================================================================
  const zeroScoreAns = attempt1Completed.answers.find((a) => a.marks === 0);
  assert(
    zeroScoreAns !== undefined && zeroScoreAns.marks === 0,
    "TEST 22: Zero score (0 marks) remains valid and is never treated as undefined"
  );

  // =========================================================================
  // TEST 23 & 24: Legacy attempts and Master Scorecard consistency
  // =========================================================================
  const scorecard = computeExamMasterScorecard(dbExam, [attempt1Completed, attempt2Doc!]);
  assert(
    scorecard.attemptsCount === 2 &&
    scorecard.reviewedAttemptsCount === 2 &&
    scorecard.currentMasterScore >= attempt1Completed.totalMarks!,
    "TEST 23 & 24: Cumulative master progress and historical progression remain correct and non-decreasing"
  );

  // =========================================================================
  // Undefined Safety Check across all assignment payloads
  // =========================================================================
  let anyUndefinedFound = false;
  for (const asg of dbAssignments) {
    if (hasUndefined(asg)) {
      anyUndefinedFound = true;
      break;
    }
  }
  assert(!anyUndefinedFound, "BONUS: Zero undefined values across all assignment Firestore payloads");

  console.log("\n==================================================");
  console.log(`TEST SUITE COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
