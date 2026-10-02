import { NextResponse } from "next/server";
import {
  verifyFirebaseIdToken,
  getServerAdminToken,
  toFirestore,
  fromFirestore,
} from "@/lib/server/auth";
import {
  validateAppSettings,
  DEFAULT_APP_SETTINGS,
} from "@/lib/settings";
import type { AppSettings } from "@/types";

const PROJECT_ID = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "moodle-adf67").replace(/"/g, "");

export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const authUser = await verifyFirebaseIdToken(authHeader);

    if (!authUser || authUser.role !== "auditor") {
      return NextResponse.json(
        { error: "Forbidden: Auditor role required to view settings." },
        { status: 403 }
      );
    }

    const adminToken = getServerAdminToken();
    const userToken = authHeader!.replace(/^Bearer\s+/i, "").trim();
    const primaryToken = adminToken || userToken;

    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/settings/application`;
    let res = await fetch(url, {
      headers: { Authorization: `Bearer ${primaryToken}` },
    });

    if (!res.ok && adminToken && userToken && userToken !== adminToken) {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${userToken}` },
      });
    }

    if (!res.ok) {
      return NextResponse.json({
        success: true,
        settings: DEFAULT_APP_SETTINGS,
      });
    }

    const doc = await res.json();
    const data = fromFirestore<Partial<AppSettings>>(doc.fields || {});

    return NextResponse.json({
      success: true,
      settings: {
        ...DEFAULT_APP_SETTINGS,
        ...data,
      },
    });
  } catch (err: any) {
    console.error("[api/admin/settings] GET error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    const authUser = await verifyFirebaseIdToken(authHeader);

    if (!authUser) {
      return NextResponse.json(
        { error: "Unauthorized: A valid Firebase ID token is required." },
        { status: 401 }
      );
    }

    if (authUser.role !== "auditor") {
      return NextResponse.json(
        { error: "Forbidden: Only authorized auditors may change application settings." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const validation = validateAppSettings(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: `Validation error: ${validation.errors.join("; ")}` },
        { status: 400 }
      );
    }

    const adminToken = getServerAdminToken();
    const userToken = authHeader!.replace(/^Bearer\s+/i, "").trim();
    const primaryToken = adminToken || userToken;

    // Whitelist only explicit settings keys
    const allowedKeys: (keyof AppSettings)[] = [
      "appName",
      "supportContactEmail",
      "defaultExamDuration",
      "defaultPassingScore",
      "allowAgentReattempts",
      "defaultReassignmentMode",
      "enableEmailNotifications",
      "notificationEmail",
      "defaultReportWindowDays",
      "requireAmendmentReason",
      "maintenanceMode",
      "maintenanceMessage",
    ];

    const sanitizedPatch: Partial<AppSettings> = {};
    for (const key of allowedKeys) {
      if (body[key] !== undefined) {
        sanitizedPatch[key] = body[key];
      }
    }

    const now = Date.now();
    const updatedSettings: AppSettings = {
      ...DEFAULT_APP_SETTINGS,
      ...sanitizedPatch,
      updatedAt: now,
      updatedBy: authUser.uid,
      updatedByName: authUser.email.split("@")[0],
    };

    const docUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/settings/application`;
    const docPayload = toFirestore(updatedSettings);

    let patchRes = await fetch(docUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${primaryToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(docPayload),
    });

    if (!patchRes.ok && adminToken && userToken && userToken !== adminToken) {
      patchRes = await fetch(docUrl, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(docPayload),
      });
    }

    if (!patchRes.ok) {
      const errData = await patchRes.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `Failed to save settings: HTTP ${patchRes.status}`);
    }

    // Write audit log entry
    try {
      const auditLogUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/audit_logs`;
      const auditPayload = toFirestore({
        action: "SETTINGS_UPDATED",
        actorId: authUser.uid,
        actorEmail: authUser.email,
        targetId: "settings/application",
        targetName: "Application Settings",
        details: {
          changedKeys: Object.keys(sanitizedPatch),
        },
        timestamp: now,
      });

      await fetch(auditLogUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${primaryToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(auditPayload),
      });
    } catch (auditErr) {
      console.warn("[api/admin/settings] Could not record audit log:", auditErr);
    }

    return NextResponse.json({
      success: true,
      settings: updatedSettings,
    });
  } catch (err: any) {
    console.error("[api/admin/settings] POST error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to update settings" },
      { status: 500 }
    );
  }
}
