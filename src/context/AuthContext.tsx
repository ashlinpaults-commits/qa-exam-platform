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

  async function loadProfileWithRetry(user: User, maxAttempts = 3): Promise<AppUser | null> {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const p = await ensureUserProfile(
          user.uid,
          user.email ?? "",
          user.displayName ?? user.email?.split("@")[0] ?? "User"
        );
        return p;
      } catch (err) {
        lastErr = err;
        console.warn(`[AuthContext] loadProfile attempt ${attempt} failed:`, err);
        if (attempt < maxAttempts) {
          await new Promise((res) => setTimeout(res, 600 * attempt));
        }
      }
    }
    throw lastErr;
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setProfile(null);
        setAuthError(null);
        setLoading(false);
        return;
      }

      try {
        const p = await loadProfileWithRetry(user);
        setProfile(p);
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

  const handleRetry = async () => {
    setAuthError(null);
    setLoading(true);
    const currentUser = auth.currentUser;
    if (currentUser) {
      try {
        const p = await loadProfileWithRetry(currentUser);
        setProfile(p);
      } catch (error) {
        setProfile(null);
        setAuthError(
          error instanceof Error
            ? error.message
            : "Unable to load your account profile."
        );
      } finally {
        setLoading(false);
      }
    } else {
      window.location.reload();
    }
  };

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
                onClick={handleRetry}
              >
                Retry
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
