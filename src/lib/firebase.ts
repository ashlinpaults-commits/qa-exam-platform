import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, initializeFirestore, memoryLocalCache } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyAtZMQx1rFDqEwSWgnGAeuBFetusxhFwag",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "moodle-adf67.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "moodle-adf67",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "moodle-adf67.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "441768017359",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:441768017359:web:7be22c0d476ac23d1826ba",
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
      ignoreUndefinedProperties: true,
      experimentalAutoDetectLongPolling: true,
    });
  } catch {
    return getFirestore(app);
  }
})();

export const storage = getStorage(app);
