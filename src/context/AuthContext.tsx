"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { ensureUserProfile } from "@/lib/users";
import type { AppUser } from "@/types";

interface AuthContextValue {
  firebaseUser: User | null;
  profile: AppUser | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  firebaseUser: null,
  profile: null,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      try {
        if (user) {
          const p = await ensureUserProfile(
            user.uid,
            user.email ?? "",
            user.displayName ?? user.email?.split("@")[0] ?? "User"
          );
          setProfile(p);
        } else {
          setProfile(null);
        }
        setAuthError(null);
      } catch (error) {
        console.error("Unable to load user profile", error);
        setProfile(null);
        setAuthError(
          error instanceof Error
            ? error.message
            : "Unable to load your account profile."
        );
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  if (authError) {
    return (
      <AuthContext.Provider value={{ firebaseUser, profile: null, loading: false }}>
        <div className="flex min-h-screen items-center justify-center p-6 text-center">
          <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-5 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            <h1 className="font-semibold text-base">Couldn&apos;t load your account</h1>
            <p className="mt-2 text-sm">{authError}</p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                className="btn-primary text-xs"
                onClick={() => {
                  if (typeof window !== "undefined" && window.indexedDB && typeof window.indexedDB.databases === "function") {
                    try {
                      window.indexedDB.databases().then((dbs) => {
                        dbs.forEach((dbInfo) => {
                          if (dbInfo.name) {
                            try {
                              window.indexedDB.deleteDatabase(dbInfo.name);
                            } catch {}
                          }
                        });
                      }).catch(() => {});
                    } catch {}
                  }
                  window.location.reload();
                }}
              >
                Clear Cache & Retry
              </button>
              <button
                className="btn-secondary text-xs"
                onClick={async () => {
                  try {
                    await auth.signOut();
                    window.location.href = "/login";
                  } catch {
                    window.location.reload();
                  }
                }}
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={{ firebaseUser, profile, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
