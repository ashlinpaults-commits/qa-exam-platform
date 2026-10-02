import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { stripUndefined } from "./questions";
import { recordAuditLog, type ActorInfo } from "./settings";
import type { AppUser, UserRole } from "@/types";

const USERS_COLLECTION = "users";

export async function getUserProfile(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(db, USERS_COLLECTION, uid));
  if (!snap.exists()) return null;
  const data = snap.data() as AppUser;
  // Standardize active status: if isActive is undefined, default to true
  return {
    ...data,
    isActive: data.isActive !== false,
    status: data.isActive === false || data.status === "inactive" ? "inactive" : "active",
  };
}

// Called once after first sign-in. Role defaults to "agent" for safety —
// auditor role must be promoted manually in Firestore or via the admin screen.
export async function ensureUserProfile(
  uid: string,
  email: string,
  name: string,
  defaultRole: UserRole = "agent"
): Promise<AppUser> {
  const existing = await getUserProfile(uid);
  if (existing) {
    // If existing user doc doesn't have isActive/status, backfill them safely
    if (existing.isActive === undefined || existing.status === undefined) {
      await updateDoc(
        doc(db, USERS_COLLECTION, uid),
        stripUndefined({
          isActive: existing.isActive !== false,
          status: existing.isActive === false ? "inactive" : "active",
        })
      ).catch(() => {});
    }
    return existing;
  }

  const profile: AppUser = {
    uid,
    email,
    name,
    role: defaultRole,
    isActive: true,
    status: "active",
    createdAt: Date.now(),
  };

  await setDoc(doc(db, USERS_COLLECTION, uid), {
    ...stripUndefined(profile),
    createdAt: serverTimestamp(),
  });

  return profile;
}

export async function fetchUsersByRole(role: UserRole): Promise<AppUser[]> {
  const snap = await getDocs(query(collection(db, USERS_COLLECTION), where("role", "==", role)));
  return snap.docs.map((d) => {
    const data = d.data() as AppUser;
    return {
      ...data,
      isActive: data.isActive !== false,
      status: data.isActive === false || data.status === "inactive" ? "inactive" : "active",
    };
  });
}

export async function fetchAllUsers(): Promise<AppUser[]> {
  const snap = await getDocs(query(collection(db, USERS_COLLECTION), orderBy("name")));
  return snap.docs.map((d) => {
    const data = d.data() as AppUser;
    return {
      ...data,
      isActive: data.isActive !== false,
      status: data.isActive === false || data.status === "inactive" ? "inactive" : "active",
    };
  });
}

/**
 * Updates a user's role with auditor lockout protection and audit logging.
 */
export async function setUserRole(
  uid: string,
  role: UserRole,
  actor?: ActorInfo
): Promise<void> {
  if (role !== "agent" && role !== "auditor") {
    throw new Error(`Unsupported role: "${role}". Only "agent" and "auditor" are supported.`);
  }

  // Prevent demoting the last auditor
  if (role === "agent") {
    const allUsers = await fetchAllUsers();
    const activeAuditors = allUsers.filter(
      (u) => u.role === "auditor" && u.isActive !== false && u.uid !== uid
    );
    if (activeAuditors.length === 0) {
      throw new Error(
        "Cannot demote the only remaining active auditor. At least one auditor must remain to manage the system."
      );
    }
  }

  const userDocRef = doc(db, USERS_COLLECTION, uid);
  const now = Date.now();

  await updateDoc(
    userDocRef,
    stripUndefined({
      role,
      updatedAt: now,
    })
  );

  if (actor) {
    await recordAuditLog({
      action: "USER_ROLE_CHANGED",
      actorId: actor.uid,
      actorEmail: actor.email,
      actorName: actor.name,
      targetId: uid,
      details: { newRole: role },
      timestamp: now,
    });
  }
}

/**
 * Updates a user's profile information (name, batch, streamId).
 */
export async function updateUserProfile(
  uid: string,
  data: {
    name?: string;
    batch?: string;
    streamId?: string;
  },
  actor?: ActorInfo
): Promise<void> {
  if (data.name !== undefined && data.name.trim().length < 2) {
    throw new Error("User name must be at least 2 characters long.");
  }

  const now = Date.now();
  const patch = stripUndefined({
    name: data.name?.trim(),
    batch: data.batch?.trim(),
    streamId: data.streamId?.trim(),
    updatedAt: now,
  });

  await updateDoc(doc(db, USERS_COLLECTION, uid), patch);

  if (actor) {
    await recordAuditLog({
      action: "USER_UPDATED",
      actorId: actor.uid,
      actorEmail: actor.email,
      actorName: actor.name,
      targetId: uid,
      details: { updatedFields: Object.keys(patch) },
      timestamp: now,
    });
  }
}

/**
 * Deactivates or reactivates a user account.
 * Deactivation is non-destructive: all historical attempts, scores, and reports remain intact.
 * Protects the current auditor from deactivating themselves or deactivating the last active auditor.
 */
export async function setUserActiveStatus(
  uid: string,
  isActive: boolean,
  actor: ActorInfo
): Promise<void> {
  if (uid === actor.uid && !isActive) {
    throw new Error("You cannot deactivate your own account.");
  }

  // If deactivating, ensure we're not deactivating the last active auditor
  if (!isActive) {
    const targetUser = await getUserProfile(uid);
    if (targetUser?.role === "auditor") {
      const allUsers = await fetchAllUsers();
      const otherActiveAuditors = allUsers.filter(
        (u) => u.role === "auditor" && u.isActive !== false && u.uid !== uid
      );
      if (otherActiveAuditors.length === 0) {
        throw new Error(
          "Cannot deactivate the only active auditor. At least one auditor must remain active."
        );
      }
    }
  }

  const now = Date.now();
  const status = isActive ? "active" : "inactive";

  await updateDoc(
    doc(db, USERS_COLLECTION, uid),
    stripUndefined({
      isActive,
      status,
      updatedAt: now,
    })
  );

  await recordAuditLog({
    action: isActive ? "USER_REACTIVATED" : "USER_DEACTIVATED",
    actorId: actor.uid,
    actorEmail: actor.email,
    actorName: actor.name,
    targetId: uid,
    details: { isActive, status },
    timestamp: now,
  });
}
