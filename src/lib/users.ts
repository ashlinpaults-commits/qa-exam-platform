import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import type { AppUser, UserRole } from "@/types";

const USERS_COLLECTION = "users";

export async function getUserProfile(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(db, USERS_COLLECTION, uid));
  return snap.exists() ? (snap.data() as AppUser) : null;
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
  if (existing) return existing;

  const profile: AppUser = {
    uid,
    email,
    name,
    role: defaultRole,
    createdAt: Date.now(),
  };
  await setDoc(doc(db, USERS_COLLECTION, uid), { ...profile, createdAt: serverTimestamp() });
  return profile;
}

export async function fetchUsersByRole(role: UserRole): Promise<AppUser[]> {
  const snap = await getDocs(query(collection(db, USERS_COLLECTION), where("role", "==", role)));
  return snap.docs.map((d) => d.data() as AppUser);
}

export async function fetchAllUsers(): Promise<AppUser[]> {
  const snap = await getDocs(query(collection(db, USERS_COLLECTION), orderBy("name")));
  return snap.docs.map((d) => d.data() as AppUser);
}

export async function setUserRole(uid: string, role: UserRole) {
  await updateDoc(doc(db, USERS_COLLECTION, uid), { role });
}

export async function updateUserName(uid: string, name: string) {
  await updateDoc(doc(db, USERS_COLLECTION, uid), { name: name.trim() });
}

export async function setUserDeactivated(uid: string, deactivated: boolean) {
  await updateDoc(doc(db, USERS_COLLECTION, uid), {
    deactivated,
    deactivatedAt: deactivated ? Date.now() : null,
  });
}

export async function deleteUserProfile(uid: string) {
  await deleteDoc(doc(db, USERS_COLLECTION, uid));
}

