import { NextRequest, NextResponse } from "next/server";
import {
  buildAiEvaluationPrompt,
  parseAiEvaluationResponse,
  evaluateFallbackSemanticAnswer,
  type QuestionEvaluationInput,
} from "@/lib/aiEvaluation";
import type { AiQuestionEvaluation } from "@/types";

export const maxDuration = 60; // Allow sufficient time for batch processing

interface RequestBody {
  attemptId: string;
  examId?: string;
  items: QuestionEvaluationInput[];
}

export async function POST(req: NextRequest) {
  try {
    const body: RequestBody = await req.json();
    const { items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No question items provided for evaluation." },
        { status: 400 }
      );
    }

    const evaluations: Record<string, AiQuestionEvaluation> = {};
    const geminiApiKey =
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY;

    const openaiApiKey = process.env.OPENAI_API_KEY;

    // Batch items in groups of up to 6 questions for reliability and token safety
    const BATCH_SIZE = 6;
    const batches: QuestionEvaluationInput[][] = [];
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      batches.push(items.slice(i, i + BATCH_SIZE));
    }

    let usedFallback = false;

    for (const batch of batches) {
      if (geminiApiKey) {
        try {
          const batchEvaluations = await evaluateBatchWithGemini(
            batch,
            geminiApiKey
          );
          Object.assign(evaluations, batchEvaluations);
          continue;
        } catch (geminiError) {
          console.warn("Gemini batch evaluation failed, checking fallback:", geminiError);
        }
      }

      if (openaiApiKey) {
        try {
          const batchEvaluations = await evaluateBatchWithOpenAI(
            batch,
            openaiApiKey
          );
          Object.assign(evaluations, batchEvaluations);
          continue;
        } catch (openaiError) {
          console.warn("OpenAI batch evaluation failed, checking fallback:", openaiError);
        }
      }

      // If no AI key is configured or AI call threw an error, use intelligent fallback
      usedFallback = true;
      batch.forEach((item) => {
        evaluations[item.questionId] = evaluateFallbackSemanticAnswer(
          item,
          geminiApiKey || openaiApiKey
            ? "AI service timed out or unavailable. Heuristic concept analysis applied; auditor review recommended."
            : "AI API key not configured on server. Heuristic concept analysis applied; auditor review recommended."
        );
      });
    }

    return NextResponse.json({
      ok: true,
      evaluations,
      isFallback: usedFallback,
      reviewedCount: Object.keys(evaluations).length,
    });
  } catch (error) {
    console.error("Unhandled error in /api/ai-review:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred during AI evaluation.",
      },
      { status: 500 }
    );
  }
}

async function evaluateBatchWithGemini(
  items: QuestionEvaluationInput[],
  apiKey: string
): Promise<Record<string, AiQuestionEvaluation>> {
  const configuredModel = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const candidateModels = Array.from(
    new Set([
      configuredModel,
      "gemini-3.5-flash-lite",
      "gemini-flash-lite-latest",
      "gemini-3.8-flash",
    ])
  );

  const prompt = buildAiEvaluationPrompt(items);
  let lastError: Error | null = null;

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 35000);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.15,
            responseMimeType: "application/json",
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        // If 503 (high demand) or 404 (model deprecated), try next model
        if (res.status === 503 || res.status === 404) {
          console.warn(`Model ${model} returned ${res.status}, attempting fallback model...`);
          lastError = new Error(`Gemini model ${model} error (${res.status}): ${errText}`);
          continue;
        }
        throw new Error(`Gemini API error (${res.status}): ${errText}`);
      }

      const data = await res.json();
      const rawText =
        data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

      return parseAiEvaluationResponse(rawText, items);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // If aborted timeout or network error on one model, try next candidate
      console.warn(`Attempt with model ${model} failed:`, err);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error("All Gemini model attempts failed.");
}

async function evaluateBatchWithOpenAI(
  items: QuestionEvaluationInput[],
  apiKey: string
): Promise<Record<string, AiQuestionEvaluation>> {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const url = "https://api.openai.com/v1/chat/completions";

  const prompt = buildAiEvaluationPrompt(items);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 35000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.15,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const rawText = data?.choices?.[0]?.message?.content || "{}";

    return parseAiEvaluationResponse(rawText, items);
  } finally {
    clearTimeout(timeoutId);
  }
}
