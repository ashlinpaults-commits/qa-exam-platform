import {
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { db, auth } from "./firebase";
import { stripUndefined } from "./questions";
import type { AppSettings, AuditLogEntry, AuditActionType } from "@/types";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  appName: "QA Exam Platform",
  supportContactEmail: "",
  defaultExamDuration: 60,
  defaultPassingScore: 70,
  allowAgentReattempts: true,
  defaultReassignmentMode: "full_exam",
  enableEmailNotifications: false,
  notificationEmail: "",
  defaultReportWindowDays: 30,
  requireAmendmentReason: true,
  maintenanceMode: false,
  maintenanceMessage: "The platform is currently undergoing scheduled maintenance. Please check back shortly.",
};

const SETTINGS_DOC_REF = () => doc(db, "settings", "application");
const AUDIT_LOGS_COLLECTION = "audit_logs";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates application settings against strict typing, ranges, and format constraints.
 * Ensures arbitrary or malformed data is never persisted.
 */
export function validateAppSettings(settings: Partial<AppSettings>): ValidationResult {
  const errors: string[] = [];

  if (settings.appName !== undefined) {
    if (typeof settings.appName !== "string" || settings.appName.trim().length < 2) {
      errors.push("Application name must be at least 2 characters long.");
    } else if (settings.appName.trim().length > 60) {
      errors.push("Application name cannot exceed 60 characters.");
    }
  }

  if (settings.supportContactEmail !== undefined && settings.supportContactEmail !== "") {
    if (
      typeof settings.supportContactEmail !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.supportContactEmail.trim())
    ) {
      errors.push("Support contact email must be a valid email address.");
    }
  }

  if (settings.defaultExamDuration !== undefined) {
    if (
      typeof settings.defaultExamDuration !== "number" ||
      isNaN(settings.defaultExamDuration) ||
      !Number.isInteger(settings.defaultExamDuration) ||
      settings.defaultExamDuration < 1 ||
      settings.defaultExamDuration > 600
    ) {
      errors.push("Default exam duration must be an integer between 1 and 600 minutes.");
    }
  }

  if (settings.defaultPassingScore !== undefined) {
    if (
      typeof settings.defaultPassingScore !== "number" ||
      isNaN(settings.defaultPassingScore) ||
      settings.defaultPassingScore < 0 ||
      settings.defaultPassingScore > 100
    ) {
      errors.push("Default passing score must be between 0% and 100%.");
    }
  }

  if (settings.allowAgentReattempts !== undefined) {
    if (typeof settings.allowAgentReattempts !== "boolean") {
      errors.push("allowAgentReattempts must be a boolean value.");
    }
  }

  if (settings.defaultReassignmentMode !== undefined) {
    if (
      settings.defaultReassignmentMode !== "full_exam" &&
      settings.defaultReassignmentMode !== "incorrect_only"
    ) {
      errors.push("defaultReassignmentMode must be either 'full_exam' or 'incorrect_only'.");
    }
  }

  if (settings.enableEmailNotifications !== undefined) {
    if (typeof settings.enableEmailNotifications !== "boolean") {
      errors.push("enableEmailNotifications must be a boolean value.");
    }
  }

  if (settings.notificationEmail !== undefined && settings.notificationEmail !== "") {
    if (
      typeof settings.notificationEmail !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(settings.notificationEmail.trim())
    ) {
      errors.push("Notification email must be a valid email address.");
    }
  }

  if (settings.defaultReportWindowDays !== undefined) {
    if (
      typeof settings.defaultReportWindowDays !== "number" ||
      isNaN(settings.defaultReportWindowDays) ||
      !Number.isInteger(settings.defaultReportWindowDays) ||
      settings.defaultReportWindowDays < 1 ||
      settings.defaultReportWindowDays > 365
    ) {
      errors.push("Default report window must be an integer between 1 and 365 days.");
    }
  }

  if (settings.requireAmendmentReason !== undefined) {
    if (typeof settings.requireAmendmentReason !== "boolean") {
      errors.push("requireAmendmentReason must be a boolean value.");
    }
  }

  if (settings.maintenanceMode !== undefined) {
    if (typeof settings.maintenanceMode !== "boolean") {
      errors.push("maintenanceMode must be a boolean value.");
    }
  }

  if (settings.maintenanceMessage !== undefined && settings.maintenanceMessage !== "") {
    if (typeof settings.maintenanceMessage !== "string" || settings.maintenanceMessage.length > 500) {
      errors.push("Maintenance message cannot exceed 500 characters.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Loads current application settings from Firestore.
 * Automatically defaults unconfigured properties to DEFAULT_APP_SETTINGS.
 */
export async function getAppSettings(): Promise<AppSettings> {
  try {
    const snap = await getDoc(SETTINGS_DOC_REF());
    if (snap.exists()) {
      const data = snap.data() as Partial<AppSettings>;
      return {
        ...DEFAULT_APP_SETTINGS,
        ...data,
      };
    }
  } catch (err: any) {
    console.warn("[settings] Failed to fetch settings from Firestore SDK, trying API fallback:", err?.message);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (idToken) {
        const res = await fetch("/api/admin/settings", {
          headers: { Authorization: `Bearer ${idToken}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.settings) return data.settings;
        }
      }
    } catch {}
  }
  return { ...DEFAULT_APP_SETTINGS };
}

export interface ActorInfo {
  uid: string;
  email: string;
  name?: string;
}

/**
 * Updates application settings in Firestore.
 * Validates updates, prevents arbitrary field injection, maintains undefined-safety,
 * and records an immutable audit log entry.
 * Includes server API fallback if client SDK experiences permissions or network lag.
 */
export async function updateAppSettings(
  updates: Partial<AppSettings>,
  actor: ActorInfo
): Promise<AppSettings> {
  const validation = validateAppSettings(updates);
  if (!validation.valid) {
    throw new Error(`Invalid settings payload: ${validation.errors.join("; ")}`);
  }

  // Whitelist only explicit settings keys to prevent arbitrary Firestore injection
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

  const current = await getAppSettings();
  const sanitizedPatch: Partial<AppSettings> = {};

  for (const key of allowedKeys) {
    if (updates[key] !== undefined) {
      sanitizedPatch[key] = updates[key] as any;
    }
  }

  const now = Date.now();
  const payloadToPersist = stripUndefined({
    ...sanitizedPatch,
    updatedAt: now,
    updatedBy: actor.uid,
    updatedByName: actor.name || actor.email.split("@")[0],
  });

  try {
    await setDoc(SETTINGS_DOC_REF(), payloadToPersist, { merge: true });
  } catch (clientErr: any) {
    console.warn("[settings] Direct client setDoc failed, attempting server API fallback:", clientErr?.message);
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) {
      throw clientErr;
    }

    const apiRes = await fetch("/api/admin/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(sanitizedPatch),
    });

    if (!apiRes.ok) {
      const errData = await apiRes.json().catch(() => ({}));
      throw new Error(errData?.error || clientErr?.message || "Failed to save settings.");
    }

    const resJson = await apiRes.json();
    return resJson.settings;
  }

  // Record audit log entry
  const changedKeys = Object.keys(sanitizedPatch);
  const diffDetails: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of changedKeys) {
    diffDetails[k] = {
      from: (current as any)[k],
      to: (sanitizedPatch as any)[k],
    };
  }

  await recordAuditLog({
    action: "SETTINGS_UPDATED",
    actorId: actor.uid,
    actorEmail: actor.email,
    actorName: actor.name || actor.email.split("@")[0],
    targetId: "settings/application",
    targetName: "Application Settings",
    details: {
      changedKeys,
      changes: diffDetails,
    },
    timestamp: now,
  });

  return {
    ...current,
    ...sanitizedPatch,
    updatedAt: now,
    updatedBy: actor.uid,
    updatedByName: actor.name || actor.email.split("@")[0],
  };
}

/**
 * Appends an immutable audit log entry to the `audit_logs` collection.
 */
export async function recordAuditLog(entry: Omit<AuditLogEntry, "id">): Promise<void> {
  try {
    const payload = stripUndefined({
      action: entry.action,
      actorId: entry.actorId,
      actorEmail: entry.actorEmail,
      actorName: entry.actorName || "",
      targetId: entry.targetId || "",
      targetName: entry.targetName || "",
      details: entry.details || {},
      timestamp: entry.timestamp || Date.now(),
    });

    await addDoc(collection(db, AUDIT_LOGS_COLLECTION), payload);
  } catch (err) {
    console.error("[audit_logs] Failed to write audit log entry:", err);
  }
}

/**
 * Fetches the most recent audit logs for the administration dashboard.
 */
export async function fetchAuditLogs(limitCount = 50): Promise<AuditLogEntry[]> {
  try {
    const q = query(
      collection(db, AUDIT_LOGS_COLLECTION),
      orderBy("timestamp", "desc"),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map((docSnap) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<AuditLogEntry, "id">),
    }));
  } catch (err) {
    console.warn("[audit_logs] Failed to fetch audit logs:", err);
    return [];
  }
}
