import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./firebase";
import type { SystemSettings } from "@/types";

export const DEFAULT_SETTINGS: SystemSettings = {
  orgName: "QA Exam Platform",
  defaultExamMode: "normal",
  correctAnswerThreshold: 70,
  enableQuestionVersioning: true,
};

let cachedSettings: SystemSettings | null = null;

/**
 * Fetch general system settings with in-memory caching to avoid redundant Firestore reads.
 */
export async function getSystemSettings(forceRefresh = false): Promise<SystemSettings> {
  if (cachedSettings && !forceRefresh) {
    return cachedSettings;
  }

  try {
    const snap = await getDoc(doc(db, "settings", "general"));
    if (snap.exists()) {
      cachedSettings = {
        ...DEFAULT_SETTINGS,
        ...(snap.data() as Partial<SystemSettings>),
      };
      return cachedSettings;
    }
  } catch (error) {
    console.error("Failed to read system settings, falling back to defaults:", error);
  }

  cachedSettings = { ...DEFAULT_SETTINGS };
  return cachedSettings;
}

/**
 * Update system settings in Firestore and synchronize the local in-memory cache.
 */
export async function updateSystemSettings(
  updates: Partial<SystemSettings>,
  updatedBy?: string
): Promise<SystemSettings> {
  const current = await getSystemSettings();
  const nextSettings: SystemSettings = {
    ...current,
    ...updates,
    updatedAt: Date.now(),
    ...(updatedBy ? { updatedBy } : {}),
  };

  await setDoc(doc(db, "settings", "general"), nextSettings, { merge: true });
  cachedSettings = nextSettings;
  return nextSettings;
}
