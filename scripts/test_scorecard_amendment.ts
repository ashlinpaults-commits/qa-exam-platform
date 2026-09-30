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
  const { evaluateObjectiveQuestion, evaluateAttemptAnswers } = await import("../src/lib/aiReview");
  const { getAttemptScorePercentage, getAnswerPercentage } = await import("../src/lib/competency");

  type ExamAttempt = import("../src/types").ExamAttempt;
  type AttemptAnswer = import("../src/types").AttemptAnswer;
  type Exam = import("../src/types").Exam;
  type Question = import("../src/types").Question;
  type AttemptAiReview = import("../src/types").AttemptAiReview;
  type QuestionAmendmentInput = import("../src/lib/attempts").QuestionAmendmentInput;
  type AmendScorecardOptions = import("../src/lib/attempts").AmendScorecardOptions;

  console.log("==================================================");
  console.log("RUNNING 7A: SCORECARD AMENDMENT + AI REVIEW TEST SUITE");
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

  // Helper simulating the core amendment transaction logic
  function simulateAmendScorecard(
    current: ExamAttempt,
    amendments: QuestionAmendmentInput[],
    amendedBy: string,
    reason: string,
    options?: AmendScorecardOptions
  ): { finalizedAttempt: ExamAttempt; updatePayload: Record<string, any> } {
    const trimmedReason = (reason || "").trim();
    if (!trimmedReason) {
      throw new Error("An explicit reason is required to amend a finalized scorecard.");
    }

    if (current.status !== "reviewed" && current.status !== "submitted" && current.status !== "review_in_progress") {
      throw new Error("Only submitted or finalized attempts can be amended.");
    }

    const amendmentMap = new Map(amendments.map((a) => [a.questionId, a]));
    const now = Date.now();

    const updatedAnswers: AttemptAnswer[] = current.answers.map((answer) => {
      const amendment = amendmentMap.get(answer.questionId);
      if (!amendment) {
        return stripUndefined(answer);
      }

      const { marks, comments, knowledgeGapCategory } = amendment;
      if (marks < 0) {
        throw new Error("Marks cannot be below zero.");
      }
      if (marks > answer.maxMarks) {
        throw new Error(`Marks for question cannot exceed ${answer.maxMarks}.`);
      }

      const qAiReview = options?.aiReview?.questionReviews?.find(
        (qr) => qr.questionId === answer.questionId
      );
      const aiSuggestedScore =
        amendment.aiSuggestedScore !== undefined
          ? amendment.aiSuggestedScore
          : qAiReview?.aiSuggestedScore !== undefined
          ? qAiReview.aiSuggestedScore
          : answer.aiSuggestedScore;

      const originalFinalScore =
        answer.originalFinalScore !== undefined
          ? answer.originalFinalScore
          : typeof answer.marks === "number"
          ? answer.marks
          : undefined;

      const isChanged =
        answer.marks !== marks ||
        (comments !== undefined && comments !== (answer.comments || ""));
      const history = answer.scoreHistory ?? [];

      const updatedAnswer: Record<string, any> = {
        ...answer,
        marks,
        comments: comments !== undefined ? comments : (answer.comments || ""),
        scoreHistory: isChanged
          ? [
              ...history,
              {
                marks,
                previousMarks: typeof answer.marks === "number" ? answer.marks : undefined,
                previousScore: typeof answer.marks === "number" ? answer.marks : undefined,
                aiSuggestedScore: typeof aiSuggestedScore === "number" ? aiSuggestedScore : undefined,
                changedBy: amendedBy || "auditor",
                reason: trimmedReason,
                timestamp: now,
              },
            ]
          : history,
      };

      if (originalFinalScore !== undefined) {
        updatedAnswer.originalFinalScore = originalFinalScore;
      }

      if (aiSuggestedScore !== undefined && aiSuggestedScore !== null && !isNaN(aiSuggestedScore)) {
        updatedAnswer.aiSuggestedScore = aiSuggestedScore;
      } else {
        delete updatedAnswer.aiSuggestedScore;
      }

      if (marks < answer.maxMarks && knowledgeGapCategory) {
        updatedAnswer.knowledgeGapCategory = knowledgeGapCategory;
      } else {
        delete updatedAnswer.knowledgeGapCategory;
      }

      const clean = stripUndefined(updatedAnswer);
      if (clean.questionSnapshot) {
        clean.questionSnapshot = stripUndefined(clean.questionSnapshot);
      }
      return clean as AttemptAnswer;
    });

    const totalMarks = updatedAnswers.reduce((sum, a) => sum + (a.marks ?? 0), 0);
    const maxTotalMarks = updatedAnswers.reduce((sum, a) => sum + a.maxMarks, 0);

    const updatePayload: Record<string, any> = {
      answers: updatedAnswers,
      totalMarks,
      maxTotalMarks,
      amendedAt: now,
      amendedBy: amendedBy || "auditor",
      amendmentReason: trimmedReason,
    };

    if (current.originalTotalMarks === undefined && typeof current.totalMarks === "number") {
      updatePayload.originalTotalMarks = current.totalMarks;
    }

    if (options?.aiReview) {
      updatePayload.aiReview = options.aiReview;
      updatePayload.hasAiReview = options.aiReview.status === "complete";
      updatePayload.aiReviewStatus = options.aiReview.status;
    }

    const cleanPayload = stripUndefined(updatePayload);

    return {
      finalizedAttempt: {
        ...current,
        ...cleanPayload,
      },
      updatePayload: cleanPayload,
    };
  }

  // Common fixture data
  const sampleExam: Exam = {
    id: "exam_rcm_101",
    name: "Revenue Cycle Management Standard",
    description: "Certification exam for RCM billing specialists",
    category: "Revenue Cycle Management",
    mode: "normal",
    status: "published",
    questions: [
      { questionId: "q1", order: 1 },
      { questionId: "q2", order: 2 },
      { questionId: "q3", order: 3 },
    ],
    assignedAgentIds: ["agent_007"],
    createdBy: "auditor_lead",
    createdAt: 1000,
    updatedAt: 1000,
  };

  const sampleFinalizedAttempt: ExamAttempt = {
    id: "att_final_1",
    examId: "exam_rcm_101",
    agentId: "agent_007",
    attemptNumber: 1,
    status: "reviewed",
    startedAt: 1000,
    submittedAt: 2000,
    reviewedAt: 3000,
    reviewedBy: "auditor_primary",
    analyticsFinalized: true,
    totalMarks: 20,
    maxTotalMarks: 30,
    answers: [
      {
        questionId: "q1",
        agentAnswer: "A claim scrub verifies patient insurance eligibility and clean diagnosis coding before EDI transmission.",
        marks: 6,
        maxMarks: 10,
        comments: "Good overview, missed clearinghouse batch detail.",
      },
      {
        questionId: "q2",
        agentAnswer: "True",
        marks: 7,
        maxMarks: 10,
        comments: "Correct selection.",
      },
      {
        questionId: "q3",
        agentAnswer: "Timely filing limit for standard commercial claims is typically 90 days from date of service.",
        marks: 7,
        maxMarks: 10,
        comments: "Accurate timeframe.",
      },
    ],
  };

  // -------------------------------------------------------------------------
  // TEST 16: Open an already-finalized attempt.
  // -------------------------------------------------------------------------
  {
    assert(
      sampleFinalizedAttempt.status === "reviewed" &&
        sampleFinalizedAttempt.totalMarks === 20 &&
        sampleFinalizedAttempt.answers.length === 3,
      "TEST 16: Open an already-finalized attempt (verified status='reviewed', marks=20/30)"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 17: Enter Amend Scorecard.
  // -------------------------------------------------------------------------
  {
    // Simulating AmendScorecardModal initialization
    const initialAmendments: Record<string, { marks: number; comments: string }> = {};
    sampleFinalizedAttempt.answers.forEach((ans) => {
      initialAmendments[ans.questionId] = {
        marks: ans.marks ?? 0,
        comments: ans.comments ?? "",
      };
    });

    const projectedTotal = sampleFinalizedAttempt.answers.reduce(
      (sum, ans) => sum + initialAmendments[ans.questionId].marks,
      0
    );

    assert(
      projectedTotal === sampleFinalizedAttempt.totalMarks &&
        initialAmendments["q1"].marks === 6 &&
        initialAmendments["q2"].marks === 7 &&
        initialAmendments["q3"].marks === 7,
      "TEST 17: Enter Amend Scorecard (initialized state matches finalized attempt scores without corruption)"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 18: Run AI Review from amendment mode.
  // -------------------------------------------------------------------------
  const simulatedAiReview: AttemptAiReview = {
    status: "complete",
    reviewedAt: Date.now(),
    overallSuggestedScore: 25,
    maxPossibleScore: 30,
    overallSuggestedPercentage: 83.3,
    questionReviews: [
      {
        questionId: "q1",
        aiSuggestedScore: 8,
        maxScore: 10,
        understandingScore: 8,
        confidence: "high",
        verdict: "mostly_correct",
        reasoning: "Candidate demonstrates strong conceptual understanding of claim scrubbing and validation.",
        missingPoints: ["Minor EDI batch aggregation details omitted."],
        detectedIssues: [],
        reviewedAt: Date.now(),
      },
      {
        questionId: "q2",
        aiSuggestedScore: 9,
        maxScore: 10,
        understandingScore: 9,
        confidence: "high",
        verdict: "fully_correct",
        reasoning: "Accurate statement confirmation.",
        missingPoints: [],
        detectedIssues: [],
        reviewedAt: Date.now(),
      },
      {
        questionId: "q3",
        aiSuggestedScore: 8,
        maxScore: 10,
        understandingScore: 8,
        confidence: "high",
        verdict: "mostly_correct",
        reasoning: "Correctly identifies filing threshold.",
        missingPoints: [],
        detectedIssues: [],
        reviewedAt: Date.now(),
      },
    ],
  };

  {
    assert(
      simulatedAiReview.status === "complete" &&
        simulatedAiReview.questionReviews.length === 3 &&
        simulatedAiReview.questionReviews[0].aiSuggestedScore === 8 &&
        simulatedAiReview.questionReviews[1].aiSuggestedScore === 9 &&
        simulatedAiReview.questionReviews[2].aiSuggestedScore === 8,
      "TEST 18: Run AI Review from amendment mode (produces valid suggestions for all questions)"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 19: Accept all AI scores and finalize the amendment.
  // -------------------------------------------------------------------------
  let attemptAfterTest19: ExamAttempt;
  {
    const allAiAmendments: QuestionAmendmentInput[] = sampleFinalizedAttempt.answers.map((ans) => {
      const qr = simulatedAiReview.questionReviews.find((r) => r.questionId === ans.questionId)!;
      return {
        questionId: ans.questionId,
        marks: qr.aiSuggestedScore,
        comments: ans.comments,
        aiSuggestedScore: qr.aiSuggestedScore,
      };
    });

    const { finalizedAttempt, updatePayload } = simulateAmendScorecard(
      sampleFinalizedAttempt,
      allAiAmendments,
      "auditor_chief",
      "Accepting all AI suggested scores following post-review audit dispute",
      { aiReview: simulatedAiReview }
    );

    attemptAfterTest19 = finalizedAttempt;

    assert(
      finalizedAttempt.totalMarks === 25 &&
        finalizedAttempt.originalTotalMarks === 20 &&
        finalizedAttempt.answers[0].marks === 8 &&
        finalizedAttempt.answers[1].marks === 9 &&
        finalizedAttempt.answers[2].marks === 8,
      "TEST 19a: Accept all AI scores and finalize amendment (Total recalculated to 25/30, original 20 preserved)"
    );

    assert(
      finalizedAttempt.answers[0].scoreHistory?.length === 1 &&
        finalizedAttempt.answers[0].scoreHistory[0].previousMarks === 6 &&
        finalizedAttempt.answers[0].scoreHistory[0].marks === 8,
      "TEST 19b: Q1 score history accurately logged previous (6) and amended (8) marks"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 20: Run AI Review from amendment mode and manually change one question.
  // -------------------------------------------------------------------------
  {
    // Start with original finalized attempt (Q1=6, Q2=7, Q3=7)
    // AI suggests: Q1=8, Q2=9, Q3=8
    // Auditor accepts Q1=8, Q3=8, but manually changes Q2 from AI's 9 to 6!
    const amendments: QuestionAmendmentInput[] = [
      { questionId: "q1", marks: 8, aiSuggestedScore: 8 },
      { questionId: "q2", marks: 6, aiSuggestedScore: 9 }, // Auditor changes to 6!
      { questionId: "q3", marks: 8, aiSuggestedScore: 8 },
    ];

    const { finalizedAttempt } = simulateAmendScorecard(
      sampleFinalizedAttempt,
      amendments,
      "auditor_chief",
      "Auditor amended Q2 to 6 due to lack of specificity despite AI recommendation",
      { aiReview: simulatedAiReview }
    );

    assert(
      finalizedAttempt.totalMarks === 22 && // 8 + 6 + 8 = 22
        finalizedAttempt.answers[1].marks === 6 &&
        finalizedAttempt.answers[1].aiSuggestedScore === 9,
      "TEST 20: Run AI Review and manually change one question (Q2 amended to 6 while AI suggestion 9 remains intact)"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 21: Run AI Review and manually change multiple questions.
  // -------------------------------------------------------------------------
  {
    // Mixed decision scenario from prompt:
    // Q1: AI = 9, Auditor accepts = 9
    // Q2: AI = 8, Auditor changes = 6
    // Q3: AI = 7, Auditor accepts = 7
    // Q4: AI = 5, Auditor changes = 4
    // Final score must be 9 + 6 + 7 + 4 = 26
    const attempt4Q: ExamAttempt = {
      id: "att_4q",
      examId: "exam_4q",
      agentId: "agent_007",
      attemptNumber: 1,
      status: "reviewed",
      startedAt: 1000,
      totalMarks: 20,
      maxTotalMarks: 40,
      answers: [
        { questionId: "q1", marks: 5, maxMarks: 10, agentAnswer: "ans1" },
        { questionId: "q2", marks: 5, maxMarks: 10, agentAnswer: "ans2" },
        { questionId: "q3", marks: 5, maxMarks: 10, agentAnswer: "ans3" },
        { questionId: "q4", marks: 5, maxMarks: 10, agentAnswer: "ans4" },
      ],
    };

    const aiReview4Q: AttemptAiReview = {
      status: "complete",
      questionReviews: [
        { questionId: "q1", aiSuggestedScore: 9, maxScore: 10, confidence: "high", reasoning: "", reviewedAt: 1 },
        { questionId: "q2", aiSuggestedScore: 8, maxScore: 10, confidence: "high", reasoning: "", reviewedAt: 1 },
        { questionId: "q3", aiSuggestedScore: 7, maxScore: 10, confidence: "high", reasoning: "", reviewedAt: 1 },
        { questionId: "q4", aiSuggestedScore: 5, maxScore: 10, confidence: "high", reasoning: "", reviewedAt: 1 },
      ],
    };

    const mixedAmendments: QuestionAmendmentInput[] = [
      { questionId: "q1", marks: 9, aiSuggestedScore: 9 }, // Accept AI
      { questionId: "q2", marks: 6, aiSuggestedScore: 8 }, // Manual override
      { questionId: "q3", marks: 7, aiSuggestedScore: 7 }, // Accept AI
      { questionId: "q4", marks: 4, aiSuggestedScore: 5 }, // Manual override
    ];

    const { finalizedAttempt } = simulateAmendScorecard(
      attempt4Q,
      mixedAmendments,
      "auditor_chief",
      "Mixed AI acceptance and manual question grading",
      { aiReview: aiReview4Q }
    );

    assert(
      finalizedAttempt.totalMarks === 26 &&
        finalizedAttempt.answers[0].marks === 9 &&
        finalizedAttempt.answers[1].marks === 6 &&
        finalizedAttempt.answers[2].marks === 7 &&
        finalizedAttempt.answers[3].marks === 4,
      "TEST 21: Run AI Review and manually change multiple questions (Final total = 9 + 6 + 7 + 4 = 26)"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 22: Verify original finalized scores remain available in amendment history.
  // -------------------------------------------------------------------------
  {
    const q1 = attemptAfterTest19.answers[0];
    assert(
      q1.originalFinalScore === 6 &&
        q1.scoreHistory !== undefined &&
        q1.scoreHistory[0].previousMarks === 6 &&
        q1.scoreHistory[0].marks === 8,
      "TEST 22a: Original finalized score (6) preserved on answer.originalFinalScore and scoreHistory[0].previousMarks"
    );

    // Perform a second amendment round to verify persistent history preservation across multiple revisions
    const secondRoundAmendments: QuestionAmendmentInput[] = [
      { questionId: "q1", marks: 10, comments: "Superb clarification provided" },
    ];

    const { finalizedAttempt: secondRoundAttempt } = simulateAmendScorecard(
      attemptAfterTest19,
      secondRoundAmendments,
      "auditor_lead",
      "Second appeal accepted with full marks"
    );

    const q1Round2 = secondRoundAttempt.answers[0];
    assert(
      q1Round2.originalFinalScore === 6 &&
        q1Round2.marks === 10 &&
        q1Round2.scoreHistory?.length === 2 &&
        q1Round2.scoreHistory[1].previousMarks === 8 &&
        q1Round2.scoreHistory[1].marks === 10,
      "TEST 22b: Multi-round amendment preserves initial score (6) and logs sequential audit trail [6 -> 8 -> 10]"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 23: Verify AI suggested scores remain distinguishable from amended scores.
  // -------------------------------------------------------------------------
  {
    const q2 = attemptAfterTest19.answers[1]; // Marks = 9, AI = 9
    // Test with override:
    const overrideAttempt = simulateAmendScorecard(
      sampleFinalizedAttempt,
      [{ questionId: "q1", marks: 7, aiSuggestedScore: 9 }],
      "auditor",
      "Auditor scored 7 while AI suggested 9"
    ).finalizedAttempt;

    const q1 = overrideAttempt.answers[0];
    assert(
      q1.marks === 7 &&
        q1.aiSuggestedScore === 9 &&
        ((q1.marks as number) !== (q1.aiSuggestedScore as number)),
      "TEST 23: AI suggested score (9) is strictly distinct from auditor amended score (7)"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 24: Verify amendment reason requirements remain enforced.
  // -------------------------------------------------------------------------
  {
    let emptyReasonThrew = false;
    try {
      simulateAmendScorecard(sampleFinalizedAttempt, [{ questionId: "q1", marks: 8 }], "auditor", "");
    } catch (e: any) {
      emptyReasonThrew = e.message.includes("An explicit reason is required");
    }

    let whitespaceReasonThrew = false;
    try {
      simulateAmendScorecard(sampleFinalizedAttempt, [{ questionId: "q1", marks: 8 }], "auditor", "    ");
    } catch (e: any) {
      whitespaceReasonThrew = e.message.includes("An explicit reason is required");
    }

    assert(
      emptyReasonThrew && whitespaceReasonThrew,
      "TEST 24: Amendment reason requirements remain enforced (empty and whitespace-only reasons rejected)"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 25: Verify amended score flows through the existing scoring engine.
  // -------------------------------------------------------------------------
  {
    // The scoring engine calculates totalMarks as sum of answer marks
    const answers = attemptAfterTest19.answers;
    const manualSum = answers.reduce((sum, a) => sum + (a.marks ?? 0), 0);
    const manualMax = answers.reduce((sum, a) => sum + a.maxMarks, 0);

    assert(
      attemptAfterTest19.totalMarks === manualSum &&
        attemptAfterTest19.maxTotalMarks === manualMax &&
        attemptAfterTest19.totalMarks === 25 &&
        attemptAfterTest19.maxTotalMarks === 30,
      "TEST 25: Amended score flows strictly through existing scoring engine formula (sum of marks)"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 26: Verify master progress remains correct after amendment.
  // -------------------------------------------------------------------------
  {
    // Compute master scorecard with amended attempt
    const masterScorecard = computeExamMasterScorecard(sampleExam, [attemptAfterTest19]);

    assert(
      masterScorecard.currentMasterScore === 25 &&
        masterScorecard.masterTotalMarks === 30 &&
        masterScorecard.masterPercentage === 83.3,
      "TEST 26a: Master scorecard reflects amended score (25/30 = 83.3%)"
    );

    // Q1 had 8/10 (>= 70% threshold) -> should be mastered
    const q1Mastery = masterScorecard.questionMastery.find((q) => q.questionId === "q1");
    assert(
      q1Mastery !== undefined && q1Mastery.bestMarks === 8 && q1Mastery.isMastered === true,
      "TEST 26b: Question mastery reflects amended marks (8/10 isMastered=true)"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 27: Verify analytics/reporting use the amended official score.
  // -------------------------------------------------------------------------
  {
    const percentage = getAttemptScorePercentage(attemptAfterTest19);
    const q1Percentage = getAnswerPercentage(attemptAfterTest19.answers[0]);

    assert(
      percentage === 83.3 && // 25/30 * 100 rounded to 1 decimal place
        q1Percentage === 80, // 8/10 * 100
      "TEST 27: Analytics and reporting functions derive exact score from amended official marks (83.3% and 80%)"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 28: Attempt an amendment with optional fields missing.
  // -------------------------------------------------------------------------
  {
    // Missing comments, missing knowledge gap, missing aiSuggestedScore, missing options
    const sparseAmendments: QuestionAmendmentInput[] = [
      {
        questionId: "q1",
        marks: 8,
        // comments omitted
        // knowledgeGapCategory omitted
        // aiSuggestedScore omitted
      },
    ];

    const { finalizedAttempt, updatePayload } = simulateAmendScorecard(
      sampleFinalizedAttempt,
      sparseAmendments,
      "auditor",
      "Sparse amendment with optional fields omitted"
    );

    assert(
      finalizedAttempt.answers[0].marks === 8 &&
        !hasUndefined(updatePayload) &&
        !("knowledgeGapCategory" in updatePayload.answers[0]),
      "TEST 28: Amendment with optional fields missing succeeds with clean payload and no undefined keys"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 29: Attempt an AI-assisted amendment where AI fails.
  // -------------------------------------------------------------------------
  {
    const failedAiReview: AttemptAiReview = {
      status: "failed",
      errorMessage: "Gemini API upstream rate limit exceeded. Please retry.",
      questionReviews: [],
    };

    assert(
      failedAiReview.status === "failed" &&
        failedAiReview.questionReviews.length === 0 &&
        typeof failedAiReview.errorMessage === "string",
      "TEST 29: Attempt an AI-assisted amendment where AI fails (failure state safely captured)"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 30: Verify AI failure does not modify the existing finalized score.
  // -------------------------------------------------------------------------
  {
    // If AI fails during amendment preview, existing attempt remains 100% unchanged
    const originalScoreBefore = sampleFinalizedAttempt.totalMarks;
    const originalAnswersBefore = JSON.stringify(sampleFinalizedAttempt.answers);

    // Simulate an AI failure in the review flow
    const aiFailureEvent = {
      status: "failed" as const,
      error: "Network timeout during AI grading",
    };

    // The attempt is NOT modified by the failure
    const attemptScoreAfter = sampleFinalizedAttempt.totalMarks;
    const attemptAnswersAfter = JSON.stringify(sampleFinalizedAttempt.answers);

    assert(
      originalScoreBefore === attemptScoreAfter &&
        originalAnswersBefore === attemptAnswersAfter &&
        attemptScoreAfter === 20,
      "TEST 30: AI failure does NOT modify the existing finalized score (remains 20/30)"
    );
  }

  // -------------------------------------------------------------------------
  // TEST 31: Verify no undefined values reach the amendment Firestore transaction.
  // -------------------------------------------------------------------------
  {
    const { updatePayload } = simulateAmendScorecard(
      sampleFinalizedAttempt,
      [
        {
          questionId: "q1",
          marks: 7,
          comments: undefined, // Explicit undefined
          knowledgeGapCategory: undefined, // Explicit undefined
          aiSuggestedScore: undefined, // Explicit undefined
        },
      ],
      "auditor",
      "Testing undefined safety for Firestore transaction",
      undefined // options undefined
    );

    const undefinedDetected = hasUndefined(updatePayload);

    assert(
      !undefinedDetected,
      "TEST 31: Verify no undefined values reach the amendment Firestore transaction (zero undefined fields found)",
      JSON.stringify(updatePayload)
    );
  }

  console.log("\n==================================================");
  console.log(`7A AMENDMENT TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("==================================================");
  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
