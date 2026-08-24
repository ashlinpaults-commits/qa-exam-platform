"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { ensureUserProfile } from "@/lib/users";
import { ShieldCheck, Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        const profile = await ensureUserProfile(
          cred.user.uid,
          cred.user.email ?? email,
          cred.user.displayName ?? email.split("@")[0]
        );
        router.push(profile.role === "auditor" ? "/auditor/dashboard" : "/agent/dashboard");
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        // New signups default to "agent". Promote to auditor manually in Firestore.
        const profile = await ensureUserProfile(cred.user.uid, email, name || email.split("@")[0]);
        router.push(profile.role === "auditor" ? "/auditor/dashboard" : "/agent/dashboard");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong";
      setError(message.replace("Firebase: ", ""));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left brand panel */}
      <div className="hidden w-1/2 flex-col justify-between bg-gradient-to-br from-brand-600 to-brand-700 p-12 text-white lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <ShieldCheck className="h-6 w-6" />
          QA Exam Platform
        </div>
        <div>
          <h1 className="text-3xl font-semibold leading-tight">
            Evaluate support agents with real, human-reviewed exams.
          </h1>
          <p className="mt-4 max-w-md text-brand-100">
            Build exams from a 2000+ question bank, track every attempt, and
            catch weak spots before they hit your customers.
          </p>
        </div>
        <p className="text-sm text-brand-100">Internal tool · Auditors & Agents</p>
      </div>

      {/* Right form panel */}
      <div className="flex w-full items-center justify-center bg-surface p-8 dark:bg-surface-dark lg:w-1/2">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold">
            {mode === "signin" ? "Welcome back" : "Create an account"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {mode === "signin"
              ? "Sign in to continue to your dashboard."
              : "New accounts start as Agent. Ask an Auditor to promote you if needed."}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <div>
                <label className="mb-1 block text-sm font-medium">Full name</label>
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jordan Lee"
                  required
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Password</label>
              <input
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-400">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <button
            className="mt-4 text-sm text-brand-600 hover:underline"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin"
              ? "Don't have an account? Sign up"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
