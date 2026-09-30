import fs from "fs";
import path from "path";
import type { ExamAttempt, AttemptAiReview, UserRole, AttemptAnswer } from "@/types";
import { extractRawAnswerText } from "../questions";

const PROJECT_ID = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "moodle-adf67").replace(/"/g, "");
const API_KEY = (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "").replace(/"/g, "");

export interface VerifiedAuthUser {
  uid: string;
  email: string;
  role: UserRole;
}

/**
 * Decodes Firestore REST API document fields into a plain JavaScript object.
 */
export function fromFirestore<T = Record<string, unknown>>(fields: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    result[k] = decodeValue(v as Record<string, any>);
  }
  return result as T;
}

function decodeValue(v: Record<string, any>): any {
  if (!v || typeof v !== "object") return v;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("doubleValue" in v) return parseFloat(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return fromFirestore(v.mapValue.fields);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  return undefined;
}

/**
 * Encodes a plain JavaScript object into Firestore REST API document fields.
 */
export function toFirestore(obj: Record<string, any>): { fields: Record<string, unknown> } {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    fields[k] = encodeValue(v);
  }
  return { fields };
}

function encodeValue(v: any): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(encodeValue) } };
  }
  if (typeof v === "object") {
    return { mapValue: toFirestore(v) };
  }
  return { nullValue: null };
}

/**
 * Resolves a server-side administrative token for Firestore access.
 * Priority:
 * 1. Process environment (service account / credentials)
 * 2. Local Firebase CLI configuration store
 */
export function getServerAdminToken(): string | null {
  try {
    // 0. Explicit environment variable override
    if (process.env.FIREBASE_ADMIN_TOKEN) {
      return process.env.FIREBASE_ADMIN_TOKEN;
    }

    // 1. Check local Firebase CLI configuration (for local dev / CLI-linked server)
    const homeDir = process.env.USERPROFILE || process.env.HOME || "";
    const configPath = path.join(homeDir, ".config", "configstore", "firebase-tools.json");
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const expiresAt = data?.tokens?.expires_at;
      // Tokens expire after 1 hour (expires_at is epoch timestamp in ms).
      // Check if expired with a 60-second safety margin.
      const isExpired = typeof expiresAt === "number" && Date.now() >= expiresAt - 60000;
      if (!isExpired && data?.tokens?.access_token) {
        return data.tokens.access_token;
      }
    }
  } catch (err) {
    console.warn("[getServerAdminToken] Could not load local admin token:", err);
  }
  return null;
}

/**
 * Verifies a Firebase Auth ID Token using Google Identity Toolkit REST API.
 */
export async function verifyFirebaseIdToken(
  authHeader: string | null
): Promise<VerifiedAuthUser | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      }
    );

    if (!res.ok) {
      console.warn("[verifyFirebaseIdToken] Google verification failed:", res.status);
      return null;
    }

    const data = await res.json();
    const user = data.users?.[0];
    if (!user || !user.localId) {
      return null;
    }

    // Determine user role from Firestore users/{uid}
    const adminToken = getServerAdminToken();
    const userUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${user.localId}`;

    let userDocRes = await fetch(userUrl, {
      headers: { Authorization: `Bearer ${adminToken || token}` },
    });

    // If admin token failed with 401, retry with user's own token (user can always read their own profile under security rules)
    if (!userDocRes.ok && adminToken && token !== adminToken) {
      userDocRes = await fetch(userUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }

    let role: UserRole = "agent";
    if (userDocRes.ok) {
      const userDocData = await userDocRes.json();
      const decodedUser = fromFirestore<{ role?: UserRole }>(userDocData.fields || {});
      if (decodedUser.role === "auditor") {
        role = "auditor";
      }
    } else {
      // Fallback: Check customAttributes if configured on the user record
      try {
        if (user.customAttributes) {
          const claims = JSON.parse(user.customAttributes);
          if (claims.role === "auditor") {
            role = "auditor";
          }
        }
      } catch {}
    }

    return {
      uid: user.localId,
      email: user.email || "",
      role,
    };
  } catch (err) {
    console.error("[verifyFirebaseIdToken] Exception during token verification:", err);
    return null;
  }
}

/**
 * Loads an Attempt document directly from Firestore REST API.
 */
export async function loadAttemptFromServer(
  attemptId: string,
  userToken: string
): Promise<ExamAttempt | null> {
  const adminToken = getServerAdminToken();
  const primaryToken = adminToken || userToken;
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/attempts/${attemptId}`;

  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${primaryToken}` },
  });

  // If adminToken was tried and failed with 401, retry with userToken (evaluated against security rules)
  if (!res.ok && adminToken && userToken && userToken !== adminToken) {
    console.warn("[loadAttemptFromServer] Admin token returned HTTP", res.status, "— retrying with user token...");
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
  }

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Failed to load attempt from Firestore: HTTP ${res.status}`);
  }

  const doc = await res.json();
  const raw = fromFirestore<any>(doc.fields || {});

  const attempt = {
    id: attemptId,
    ...raw,
  } as ExamAttempt;

  // Crucial: Normalize agent-owned draft answers into answers array so
  // semantic grading receives the agent's actual responses instead of blank placeholders.
  const agentAnswers = attempt.agentAnswers ?? {};
  const existingAnswers = attempt.answers || [];
  const qidSet = new Set<string>();

  for (const ans of existingAnswers) {
    const qid = ans.questionId || (ans as any).id || ans.questionSnapshot?.id;
    if (qid) qidSet.add(qid);
  }
  for (const qid of Object.keys(agentAnswers)) {
    if (qid) qidSet.add(qid);
  }

  attempt.answers = Array.from(qidSet).map((qid) => {
    const existing = existingAnswers.find(
      (a) => (a.questionId || (a as any).id || a.questionSnapshot?.id) === qid
    );
    let draft = agentAnswers[qid];
    if (draft === undefined && typeof qid === "string") {
      draft = agentAnswers[qid.trim()];
    }
    const rawVal = draft !== undefined && draft !== null ? draft : existing?.agentAnswer || "";
    const finalAns = extractRawAnswerText(rawVal);
    return {
      ...(existing || {}),
      questionId: qid,
      agentAnswer: finalAns,
      maxMarks: existing?.maxMarks || 10,
    };
  });

  return attempt;
}

/**
 * Loads the confidential AI Review from aiReviews/{attemptId}.
 */
export async function loadAiReviewFromServer(
  attemptId: string,
  token: string
): Promise<AttemptAiReview | null> {
  const adminToken = getServerAdminToken();
  const primaryToken = adminToken || token;
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/aiReviews/${attemptId}`;

  let res = await fetch(url, {
    headers: { Authorization: `Bearer ${primaryToken}` },
  });

  if (!res.ok && adminToken && token && token !== adminToken) {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  if (!res.ok) {
    return null;
  }

  const doc = await res.json();
  const raw = fromFirestore<any>(doc.fields || {});
  return (raw.aiReview || raw) as AttemptAiReview;
}

/**
 * Persists the confidential AI Review into aiReviews/{attemptId} and flags hasAiReview on attempt.
 */
export async function saveAiReviewToServer(
  attemptId: string,
  aiReview: AttemptAiReview,
  userToken: string
): Promise<boolean> {
  const adminToken = getServerAdminToken();
  const primaryToken = adminToken || userToken;

  // 1. Write confidential AI review to dedicated aiReviews collection (accessible only to auditors)
  const aiReviewUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/aiReviews/${attemptId}`;
  const payload = toFirestore({
    attemptId,
    aiReview,
    status: aiReview.status,
    updatedAt: Date.now(),
  });

  let aiRes = await fetch(aiReviewUrl, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${primaryToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!aiRes.ok && adminToken && userToken && userToken !== adminToken) {
    aiRes = await fetch(aiReviewUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${userToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }

  if (!aiRes.ok) {
    console.warn("[saveAiReviewToServer] Note: Could not write aiReview via REST:", aiRes.status);
    return false;
  }

  // 2. Patch attempt document with safe flags (hasAiReview: true, aiReviewStatus: status)
  // Does NOT write reasoning or rubrics to attempt document so agents cannot read them.
  try {
    const attemptPatchUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/attempts/${attemptId}?updateMask.fieldPaths=hasAiReview&updateMask.fieldPaths=aiReviewStatus`;
    const attemptPatchPayload = toFirestore({
      hasAiReview: aiReview.status === "complete",
      aiReviewStatus: aiReview.status,
    });

    let patchRes = await fetch(attemptPatchUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${primaryToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(attemptPatchPayload),
    });

    if (!patchRes.ok && adminToken && userToken && userToken !== adminToken) {
      await fetch(attemptPatchUrl, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(attemptPatchPayload),
      });
    }
  } catch (err) {
    console.warn("[saveAiReviewToServer] Note: Could not patch attempt doc flags:", err);
  }

  return true;
}
