import { NextResponse } from "next/server";
import { evaluateAttemptAnswers, buildAuthoritativeAnswers } from "@/lib/aiReview";
import { extractRawAnswerText } from "@/lib/questions";
import {
  verifyFirebaseIdToken,
  loadAttemptFromServer,
  loadAiReviewFromServer,
  saveAiReviewToServer,
} from "@/lib/server/auth";
import type { Question, AttemptAnswer, AttemptAiReview, ExamAttempt } from "@/types";

export async function POST(request: Request) {
  try {
    // 1. Authenticate Caller using Firebase Auth ID token
    const authHeader = request.headers.get("authorization");
    const authUser = await verifyFirebaseIdToken(authHeader);

    if (!authUser) {
      return NextResponse.json(
        { error: "Unauthorized: A valid Firebase ID token is required in Authorization header." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { attemptId, forceRegenerate, questions: clientQuestions } = body;

    if (!attemptId || typeof attemptId !== "string") {
      return NextResponse.json(
        { error: "attemptId is required." },
        { status: 400 }
      );
    }

    const userToken = authHeader!.replace(/^Bearer\s+/i, "").trim();

    // 2. Load Attempt from Firestore (Authoritative Source of Truth) with graceful client fallback
    let attempt: ExamAttempt | null = null;
    try {
      attempt = await loadAttemptFromServer(attemptId, userToken);
    } catch (loadErr: any) {
      console.warn(`[AI Review API] Server Firestore REST loadAttempt warning: ${loadErr?.message || loadErr}`);
    }

    // Fallback: If server Firestore REST read could not load the document,
    // verify and use client-provided attempt data matching attemptId
    if (!attempt && body.attempt && body.attempt.id === attemptId) {
      console.log(`[AI Review API] Using client-provided attempt fallback for attemptId=${attemptId}`);
      attempt = body.attempt as ExamAttempt;
    }

    if (!attempt) {
      return NextResponse.json(
        { error: `Attempt "${attemptId}" not found or could not be loaded.` },
        { status: 404 }
      );
    }

    // 3. Verify Authorization
    // Auditors may evaluate any attempt. Agents can only trigger AI review for their own submitted attempts.
    if (authUser.role !== "auditor") {
      if (attempt.agentId !== authUser.uid) {
        return NextResponse.json(
          { error: "Forbidden: You are not authorized to evaluate attempts for other agents." },
          { status: 403 }
        );
      }
    }

    // Agents cannot force regeneration — only auditors can trigger re-evaluation
    const isAuditor = authUser.role === "auditor";
    const allowRegenerate = isAuditor && Boolean(forceRegenerate);

    // 4. Idempotency & Caching Check
    // If a valid complete AI review already exists and regeneration is not requested, return cached
    let existingReview: AttemptAiReview | null = null;
    try {
      existingReview = await loadAiReviewFromServer(attemptId, userToken);
    } catch (loadReviewErr) {
      console.warn("[AI Review API] Could not check existing AI review:", loadReviewErr);
    }

    if (!existingReview && attempt.aiReview && attempt.aiReview.status === "complete") {
      existingReview = attempt.aiReview;
    }

    // Prevent returning stale/corrupted reviews where substantive answers were previously graded as no_answer
    const isCorruptedCachedReview =
      existingReview &&
      existingReview.questionReviews?.some((qr) => {
        const stored = (attempt?.agentAnswers as any)?.[qr.questionId];
        const rawText = extractRawAnswerText(stored);
        return qr.verdict === "no_answer" && rawText.trim().length > 0;
      });

    if (
      existingReview &&
      existingReview.status === "complete" &&
      !allowRegenerate &&
      !isCorruptedCachedReview
    ) {
      console.log(`[AI Review API] Returning cached review for attemptId=${attemptId}`);
      if (isAuditor) {
        return NextResponse.json({
          success: true,
          cached: true,
          aiReview: existingReview,
        });
      } else {
        // Strict Agent Security: Do not expose AI review data to agent
        return NextResponse.json({
          success: true,
          cached: true,
          message: "Attempt review is already processed and queued for auditor evaluation.",
        });
      }
    }

    // 5. Resolve Questions & Answers from Attempt
    // Read authoritative persisted agent answers from attempt.agentAnswers while preserving attempt.answers
    const clientQuestionsArray = Array.isArray(clientQuestions) ? clientQuestions : [];
    const normalizedItems = buildAuthoritativeAnswers(
      attempt.agentAnswers ?? {},
      attempt.answers ?? [],
      clientQuestionsArray
    );

    if (normalizedItems.length === 0) {
      return NextResponse.json(
        { error: "Attempt contains no questions to evaluate." },
        { status: 400 }
      );
    }

    const answers: AttemptAnswer[] = normalizedItems.map((item) => ({
      questionId: item.questionId,
      agentAnswer: item.agentAnswer,
      maxMarks: item.maxMarks,
      questionSnapshot: item.questionSnapshot,
    }));

    // Client questions map for context enrichment
    const clientQuestionsMap = new Map<string, Question>();
    clientQuestionsArray.forEach((q) => {
      if (q && (q.id || (q as any).questionId)) {
        clientQuestionsMap.set(q.id || (q as any).questionId, q);
      }
    });

    // Server-side dev logging: Single debug trace immediately before semantic grading
    if (process.env.NODE_ENV !== "production" || process.env.DEBUG_AI_GRADING === "true") {
      for (const item of normalizedItems) {
        const matchedQ = clientQuestionsMap.get(item.questionId) || item.questionSnapshot;
        const qType = matchedQ?.type || "descriptive";
        console.log(
          `AI GRADING DEBUG\n` +
          `attemptId: ${attemptId}\n` +
          `questionId: ${item.questionId}\n` +
          `questionType: ${qType}\n` +
          `answerSource: ${item.answerSource}\n` +
          `rawAgentAnswer: ${typeof item.rawAgentAnswer === "string" ? JSON.stringify(item.rawAgentAnswer) : JSON.stringify(item.rawAgentAnswer)}\n` +
          `normalizedAgentAnswer: ${JSON.stringify(item.agentAnswer)}\n` +
          `answerPresent: ${item.answerPresent}`
        );
      }
    }

    // Resolve question context prioritizing complete question definitions while preserving frozen snapshots
    const resolvedQuestions: Question[] = answers.map((ans) => {
      const snap = ans.questionSnapshot;
      const clientQ = clientQuestionsMap.get(ans.questionId) || clientQuestionsMap.get(ans.questionId?.trim());
      return {
        ...(snap || clientQ || {}),
        id: ans.questionId,
        questionText: clientQ?.questionText || snap?.questionText || "Question",
        type: clientQ?.type || snap?.type || "descriptive",
        expectedAnswer: clientQ?.expectedAnswer || snap?.expectedAnswer || "",
        notes: clientQ?.notes || snap?.notes || "",
        correctOptionIndex: clientQ?.correctOptionIndex ?? snap?.correctOptionIndex,
        orderItems: clientQ?.orderItems || snap?.orderItems,
        options: clientQ?.options || snap?.options,
      } as Question;
    });

    // 6. Execute AI Review Engine
    let aiReview: AttemptAiReview;
    try {
      aiReview = await evaluateAttemptAnswers(resolvedQuestions, answers, attemptId);
    } catch (evalErr: any) {
      console.error("[AI Review API] AI Evaluation engine error:", evalErr);
      // Ensure failure does not block manual review
      aiReview = {
        status: "failed",
        errorMessage: evalErr?.message || "AI review service temporarily unavailable.",
        questionReviews: [],
      };
    }

    // 7. Persist AI Review Server-Side
    // Saves to confidential aiReviews collection (accessible only to auditors)
    // and sets safe flags (hasAiReview: true) on attempt document.
    try {
      await saveAiReviewToServer(attemptId, aiReview, userToken);
    } catch (saveErr) {
      console.warn("[AI Review API] Server persistence warning (auditor client will sync directly):", saveErr);
    }

    // 8. Controlled Data Projection in Response
    // Auditors receive the full AI review with reasoning and suggested marks.
    // Agents receive confirmation only, without internal AI reasoning or rubrics.
    if (isAuditor) {
      return NextResponse.json({
        success: true,
        cached: false,
        aiReview,
      });
    } else {
      return NextResponse.json({
        success: true,
        cached: false,
        message: "Attempt submitted and AI evaluation completed.",
      });
    }
  } catch (error: any) {
    console.error("[AI Review API] Fatal error in route handler:", error);
    return NextResponse.json(
      {
        error: error.message || "Failed to process AI review.",
      },
      { status: 500 }
    );
  }
}
