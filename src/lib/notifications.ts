import {
  collection,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import type { AppNotification } from "@/types";

const NOTIFICATIONS_COLLECTION = "user_notifications";

/**
 * Fetch the latest notifications for a specific user.
 */
export async function fetchUserNotifications(
  userId: string,
  limitCount = 20
): Promise<AppNotification[]> {
  try {
    const q = query(
      collection(db, NOTIFICATIONS_COLLECTION),
      where("userId", "==", userId),
      orderBy("createdAt", "desc"),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<AppNotification, "id">),
    }));
  } catch (error) {
    console.error("Failed to fetch notifications:", error);
    return [];
  }
}

/**
 * Mark a single notification as read.
 */
export async function markNotificationAsRead(notificationId: string): Promise<void> {
  try {
    await updateDoc(doc(db, NOTIFICATIONS_COLLECTION, notificationId), {
      read: true,
    });
  } catch (error) {
    console.error("Failed to mark notification as read:", error);
  }
}

/**
 * Mark all unread notifications for a user as read.
 */
export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  try {
    const q = query(
      collection(db, NOTIFICATIONS_COLLECTION),
      where("userId", "==", userId),
      where("read", "==", false)
    );
    const snap = await getDocs(q);
    if (snap.empty) return;

    const batch = writeBatch(db);
    snap.docs.forEach((d) => {
      batch.update(d.ref, { read: true });
    });
    await batch.commit();
  } catch (error) {
    console.error("Failed to mark all notifications as read:", error);
  }
}

/**
 * Dispatch exam assignment notifications to a list of agent IDs.
 */
export async function sendAssignmentNotifications(
  agentIds: string[],
  examName: string,
  examId: string
): Promise<void> {
  if (!agentIds || agentIds.length === 0) return;

  try {
    const batch = writeBatch(db);
    const now = Date.now();

    agentIds.forEach((agentId) => {
      const notifRef = doc(collection(db, NOTIFICATIONS_COLLECTION));
      const payload: Omit<AppNotification, "id"> = {
        userId: agentId,
        type: "exam_assigned",
        title: "New Exam Assigned",
        message: `You have been assigned to take "${examName}".`,
        link: `/agent/exams/${examId}/take`,
        examId,
        read: false,
        createdAt: now,
      };
      batch.set(notifRef, payload);
    });

    await batch.commit();
  } catch (error) {
    console.error("Failed to send assignment notifications:", error);
  }
}
