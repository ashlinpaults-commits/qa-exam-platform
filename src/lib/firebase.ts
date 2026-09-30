import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, initializeFirestore, memoryLocalCache } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Use in-memory local cache to eliminate IndexedDbTransactionError ('Allocate target' failed AbortError).
// This guarantees zero local storage lockups, zero corruption across multiple browser tabs,
// and ensures fresh live state across all sessions.
export const db = (() => {
  try {
    return initializeFirestore(app, {
      localCache: memoryLocalCache(),
    });
  } catch {
    return getFirestore(app);
  }
})();

// Clean up any stale IndexedDB databases left behind by legacy persistentMultipleTabManager
if (typeof window !== "undefined" && window.indexedDB && typeof window.indexedDB.databases === "function") {
  try {
    window.indexedDB.databases().then((dbs) => {
      dbs.forEach((dbInfo) => {
        if (dbInfo.name && dbInfo.name.startsWith("firestore/")) {
          try {
            window.indexedDB.deleteDatabase(dbInfo.name);
          } catch {}
        }
      });
    }).catch(() => {});
  } catch {}
}
export const storage = getStorage(app);
