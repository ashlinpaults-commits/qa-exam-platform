"use client";

import { useEffect, useState, useMemo } from "react";
import { fetchAllUsers, setUserRole } from "@/lib/users";
import { fetchExams } from "@/lib/exams";
import { fetchAssignmentsForExam, revokeAssignment } from "@/lib/assignments";
import { db } from "@/lib/firebase";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import type { AppUser, Exam, ExamAssignment } from "@/types";
import { Badge, Modal } from "@/components/ui/Primitives";
import { useAuth } from "@/context/AuthContext";
import {
  ChevronDown,
  ChevronRight,
  Shield,
  User,
  XCircle,
  AlertTriangle,
  CheckCircle2,
  BookOpen,
  Search,
  Loader2,
} from "lucide-react";
import { deriveCleanTitle } from "@/components/exam-builder/ExamListScreen";

interface ActiveExamItem {
  examId: string;
  assignmentId?: string;
  examName: string;
  type: "original" | "reassigned";
  reassignmentMode?: string;
  attemptNumber?: number;
  status: "assigned" | "in_progress";
  assignedAt: number;
}

export function AdminUsersScreen() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [assignments, setAssignments] = useState<ExamAssignment[]>([]);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Revocation Modal State
  const [revokingTarget, setRevokingTarget] = useState<{
    user: AppUser;
    item: ActiveExamItem;
  } | null>(null);
  const [revokingInProgress, setRevokingInProgress] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const [loadedUsers, loadedExams] = await Promise.all([
        fetchAllUsers(),
        fetchExams(),
      ]);
      setUsers(loadedUsers);
      setExams(loadedExams);
    } catch (err) {
      console.error("Failed to load admin users data", err);
      setError(err instanceof Error ? err.message : "Failed to load users data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Real-time listener for all assignments so status changes and revokes are live
  useEffect(() => {
    const q = collection(db, "assignments");
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ExamAssignment, "id">),
        }));
        setAssignments(list);
      },
      (err) => console.warn("[AdminUsersScreen] Assignments realtime error:", err)
    );

    return () => unsubscribe();
  }, []);

  // Compute active assigned exams per agent
  const activeExamsByAgent = useMemo(() => {
    const map = new Map<string, ActiveExamItem[]>();

    for (const u of users) {
      if (u.role !== "agent") continue;
      const items: ActiveExamItem[] = [];
      const handledExamIds = new Set<string>();

      // 1. From assignments collection: active assignments
      const agentAssignments = assignments.filter(
        (a) => a.agentId === u.uid && (a.status === "assigned" || a.status === "in_progress")
      );

      for (const asg of agentAssignments) {
        const matchedExam = exams.find((e) => e.id === asg.examId);
        const title = matchedExam ? deriveCleanTitle(matchedExam, 0).title : asg.examName || "Exam";
        items.push({
          examId: asg.examId,
          assignmentId: asg.id,
          examName: title,
          type: asg.assignmentType,
          reassignmentMode: asg.reassignmentMode,
          attemptNumber: asg.attemptNumber,
          status: asg.status as "assigned" | "in_progress",
          assignedAt: asg.assignedAt || 0,
        });
        handledExamIds.add(asg.examId);
      }

      // 2. From exams collection: standard assignments not already in assignments collection
      for (const exam of exams) {
        if (handledExamIds.has(exam.id)) continue;
        if (Array.isArray(exam.assignedAgentIds) && exam.assignedAgentIds.includes(u.uid)) {
          const title = deriveCleanTitle(exam, 0).title;
          items.push({
            examId: exam.id,
            examName: title,
            type: "original",
            status: "assigned",
            assignedAt: exam.createdAt || 0,
          });
        }
      }

      map.set(u.uid, items.sort((a, b) => b.assignedAt - a.assignedAt));
    }

    return map;
  }, [users, exams, assignments]);

  async function toggleRole(u: AppUser) {
    if (u.uid === profile?.uid) {
      if (!confirm("You're about to change your own role, which may lock you out of this screen. Continue?")) return;
    }
    const newRole = u.role === "auditor" ? "agent" : "auditor";

    if (u.role === "auditor" && newRole === "agent") {
      const remainingAuditors = users.filter(
        (x) => x.role === "auditor" && x.uid !== u.uid
      ).length;
      if (remainingAuditors === 0) {
        setError("Can't remove the last auditor — this would lock everyone out of review and admin screens.");
        return;
      }
    }

    setError("");
    try {
      await setUserRole(u.uid, newRole);
      setUsers((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, role: newRole } : x)));
    } catch (err) {
      console.error("Failed to change role", err);
      setError(err instanceof Error ? err.message : "Couldn't change role. Please retry.");
    }
  }

  async function handleConfirmRevoke() {
    if (!revokingTarget) return;
    const { user, item } = revokingTarget;

    try {
      setRevokingInProgress(true);
      setError("");

      await revokeAssignment({
        examId: item.examId,
        agentId: user.uid,
        assignmentId: item.assignmentId,
        revokedBy: profile?.uid || "auditor",
      });

      // Optimistically update local exams and assignments
      if (item.assignmentId) {
        setAssignments((prev) =>
          prev.map((a) =>
            a.id === item.assignmentId ? { ...a, status: "revoked" as const } : a
          )
        );
      }
      setExams((prev) =>
        prev.map((e) =>
          e.id === item.examId
            ? {
                ...e,
                assignedAgentIds: (e.assignedAgentIds || []).filter((id) => id !== user.uid),
              }
            : e
        )
      );

      setSuccessMessage(`Assignment for "${item.examName}" revoked successfully from ${user.name}.`);
      setRevokingTarget(null);
    } catch (err: any) {
      console.error("Failed to revoke assignment:", err);
      setError(err.message || "Failed to revoke assignment.");
    } finally {
      setRevokingInProgress(false);
    }
  }

  const filteredUsers = useMemo(() => {
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [users, searchQuery]);

  if (loading) return <p className="text-sm text-slate-400">Loading users...</p>;

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            className="text-xs text-green-700 hover:underline dark:text-green-400"
            onClick={() => setSuccessMessage("")}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Search Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            className="input pl-9"
            placeholder="Search users by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <p className="text-xs text-slate-500">
          Showing {filteredUsers.length} user{filteredUsers.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800">
            <tr>
              <th className="p-3 w-8"></th>
              <th className="p-3">User</th>
              <th className="p-3">Email</th>
              <th className="p-3">Role</th>
              <th className="p-3">Active Assigned Tests</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((u) => {
              const isAgent = u.role === "agent";
              const activeExams = activeExamsByAgent.get(u.uid) || [];
              const isExpanded = expandedUser === u.uid;

              return (
                <tr key={u.uid} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                  <td className="p-3 text-center">
                    {isAgent && activeExams.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setExpandedUser(isExpanded ? null : u.uid)}
                        className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    ) : null}
                  </td>
                  <td className="p-3 font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    {u.role === "auditor" ? (
                      <Shield className="h-4 w-4 text-brand-600 shrink-0" />
                    ) : (
                      <User className="h-4 w-4 text-slate-400 shrink-0" />
                    )}
                    <span>{u.name}</span>
                  </td>
                  <td className="p-3 text-slate-500">{u.email}</td>
                  <td className="p-3">
                    <Badge color={u.role === "auditor" ? "brand" : "slate"}>
                      {u.role}
                    </Badge>
                  </td>
                  <td className="p-3">
                    {isAgent ? (
                      activeExams.length > 0 ? (
                        <button
                          type="button"
                          className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline"
                          onClick={() => setExpandedUser(isExpanded ? null : u.uid)}
                        >
                          <Badge color="brand">{activeExams.length} active</Badge>
                          <span>{isExpanded ? "Hide assignments" : "View & Revoke"}</span>
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">None</span>
                      )
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      className="btn-secondary text-xs"
                      onClick={() => toggleRole(u)}
                    >
                      Make {u.role === "auditor" ? "Agent" : "Auditor"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Expanded Active Assignments Drawer / Card for selected agent */}
      {expandedUser && (() => {
        const targetAgent = users.find((u) => u.uid === expandedUser);
        const activeExams = activeExamsByAgent.get(expandedUser) || [];

        return (
          <div className="card border-l-4 border-l-brand-600 p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-brand-600" />
                <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                  Active Assigned Tests — {targetAgent?.name || "Agent"}
                </h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {activeExams.length} active
                </span>
              </div>
              <button
                type="button"
                className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                onClick={() => setExpandedUser(null)}
              >
                Close
              </button>
            </div>

            {activeExams.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">
                No active exams currently assigned to this agent.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeExams.map((item) => {
                  const isReassigned = item.type === "reassigned";
                  const isInProgress = item.status === "in_progress";

                  return (
                    <div
                      key={item.assignmentId || item.examId}
                      className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-800"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold text-sm text-slate-900 dark:text-slate-100 line-clamp-1">
                            {item.examName}
                          </p>
                          <Badge color={isInProgress ? "amber" : isReassigned ? "indigo" : "brand"}>
                            {isInProgress ? "In Progress" : isReassigned ? "Reassigned" : "Assigned"}
                          </Badge>
                        </div>

                        <p className="mt-1 text-xs text-slate-500">
                          {isReassigned ? (
                            <span>
                              Attempt #{item.attemptNumber || 2} · {item.reassignmentMode?.replace("_", " ") || "Reassigned"}
                            </span>
                          ) : (
                            <span>Original Assignment</span>
                          )}
                          {item.assignedAt ? ` · Assigned on ${new Date(item.assignedAt).toLocaleDateString()}` : ""}
                        </p>
                      </div>

                      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-700">
                        <span className="text-[11px] text-slate-400">
                          {isInProgress ? "Agent started exam" : "Awaiting agent"}
                        </span>
                        <button
                          type="button"
                          className="flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-600 shadow-sm hover:bg-red-50 dark:border-red-900/60 dark:bg-slate-800 dark:text-red-400 dark:hover:bg-red-950/40"
                          onClick={() => {
                            if (targetAgent) {
                              setRevokingTarget({ user: targetAgent, item });
                            }
                          }}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Revoke Assignment
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Revocation Confirmation Modal */}
      {revokingTarget && (
        <Modal
          open={!!revokingTarget}
          onClose={() => {
            if (!revokingInProgress) setRevokingTarget(null);
          }}
          title="Revoke Exam Assignment"
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200 flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-amber-950 dark:text-amber-100">
                  Are you sure you want to revoke this assignment?
                </p>
                <p className="mt-1">
                  Target Agent: <strong className="font-bold">{revokingTarget.user.name}</strong> ({revokingTarget.user.email})
                </p>
                <p className="mt-0.5">
                  Exam: <strong className="font-bold">{revokingTarget.item.examName}</strong>
                </p>
                {revokingTarget.item.status === "in_progress" ? (
                  <p className="mt-2 font-medium text-red-700 dark:text-red-300">
                    ⚠️ This exam currently has an attempt in progress. Revoking will terminate the attempt and prevent the agent from continuing. Historical completed attempts will remain completely safe.
                  </p>
                ) : (
                  <p className="mt-2 text-slate-600 dark:text-slate-400">
                    The exam will be immediately removed from the agent&apos;s active exam list so they can no longer start it. Historical completed attempts will remain completely safe.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setRevokingTarget(null)}
                disabled={revokingInProgress}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
                onClick={handleConfirmRevoke}
                disabled={revokingInProgress}
              >
                {revokingInProgress ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Revoking...
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5" />
                    Confirm Revoke
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
