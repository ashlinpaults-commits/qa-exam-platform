"use client";

import { useEffect, useState, useMemo } from "react";
import {
  fetchAllUsers,
  setUserRole,
  updateUserProfile,
  setUserActiveStatus,
} from "@/lib/users";
import { fetchExams } from "@/lib/exams";
import { revokeAssignment } from "@/lib/assignments";
import { db, auth } from "@/lib/firebase";
import { collection, onSnapshot } from "firebase/firestore";
import type { AppUser, Exam, ExamAssignment, UserRole } from "@/types";
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
  UserPlus,
  Edit2,
  UserCheck,
  UserX,
  Copy,
  Key,
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

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | "agent" | "auditor">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Add User Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "",
    email: "",
    role: "agent" as UserRole,
    password: "",
    batch: "",
    streamId: "",
  });
  const [addingUser, setAddingUser] = useState(false);
  const [addError, setAddError] = useState("");
  const [createdUserInfo, setCreatedUserInfo] = useState<{
    user: AppUser;
    tempPassword?: string;
  } | null>(null);

  // Edit User Modal State
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    batch: "",
    streamId: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState("");

  // Role Change Confirmation Modal State
  const [roleChangeTarget, setRoleChangeTarget] = useState<{
    user: AppUser;
    targetRole: UserRole;
  } | null>(null);
  const [changingRole, setChangingRole] = useState(false);

  // Deactivate / Reactivate Modal State
  const [statusChangeTarget, setStatusChangeTarget] = useState<{
    user: AppUser;
    targetActive: boolean;
  } | null>(null);
  const [changingStatus, setChangingStatus] = useState(false);

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
    } catch (err: any) {
      console.error("Failed to load admin users data", err);
      setError(err instanceof Error ? err.message : "Failed to load users data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  // Real-time listener for all assignments so active test counts and revokes are live
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

  // Filtered users list
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchesSearch =
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (u.batch && u.batch.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesRole = roleFilter === "all" || u.role === roleFilter;

      const isUserActive = u.isActive !== false;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && isUserActive) ||
        (statusFilter === "inactive" && !isUserActive);

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, searchQuery, roleFilter, statusFilter]);

  // Auditor Counts
  const activeAuditorsCount = useMemo(() => {
    return users.filter((u) => u.role === "auditor" && u.isActive !== false).length;
  }, [users]);

  // Handlers for Add User
  async function handleAddUserSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;

    setAddError("");
    setAddingUser(true);

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error("Authentication token expired. Please sign in again.");
      }

      const res = await fetch("/api/admin/users/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(addForm),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create user account.");
      }

      const newUser: AppUser = data.user;
      setUsers((prev) => [newUser, ...prev]);
      setCreatedUserInfo({
        user: newUser,
        tempPassword: data.temporaryPassword,
      });

      setSuccessMessage(`Account for ${newUser.name} (${newUser.email}) created successfully.`);
    } catch (err: any) {
      console.error("Add user failed:", err);
      setAddError(err.message || "Failed to create user.");
    } finally {
      setAddingUser(false);
    }
  }

  // Handlers for Edit User
  function startEditingUser(u: AppUser) {
    setEditingUser(u);
    setEditForm({
      name: u.name || "",
      batch: u.batch || "",
      streamId: u.streamId || "",
    });
    setEditError("");
  }

  async function handleSaveUserEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser || !profile) return;

    setSavingEdit(true);
    setEditError("");

    try {
      await updateUserProfile(
        editingUser.uid,
        {
          name: editForm.name,
          batch: editForm.batch,
          streamId: editForm.streamId,
        },
        {
          uid: profile.uid,
          email: profile.email,
          name: profile.name,
        }
      );

      setUsers((prev) =>
        prev.map((u) =>
          u.uid === editingUser.uid
            ? {
                ...u,
                name: editForm.name.trim(),
                batch: editForm.batch.trim(),
                streamId: editForm.streamId.trim(),
                updatedAt: Date.now(),
              }
            : u
        )
      );

      setSuccessMessage(`Profile for ${editForm.name} updated successfully.`);
      setEditingUser(null);
    } catch (err: any) {
      console.error("Failed to update user:", err);
      setEditError(err.message || "Failed to save profile changes.");
    } finally {
      setSavingEdit(false);
    }
  }

  // Handlers for Role Change
  function requestRoleChange(u: AppUser) {
    const nextRole: UserRole = u.role === "auditor" ? "agent" : "auditor";

    if (u.role === "auditor" && activeAuditorsCount <= 1) {
      setError("Cannot demote the only remaining active auditor. The system must always have at least one auditor.");
      return;
    }

    setRoleChangeTarget({ user: u, targetRole: nextRole });
  }

  async function confirmRoleChange() {
    if (!roleChangeTarget || !profile) return;
    const { user, targetRole } = roleChangeTarget;

    setChangingRole(true);
    setError("");

    try {
      await setUserRole(user.uid, targetRole, {
        uid: profile.uid,
        email: profile.email,
        name: profile.name,
      });

      setUsers((prev) =>
        prev.map((u) => (u.uid === user.uid ? { ...u, role: targetRole, updatedAt: Date.now() } : u))
      );

      setSuccessMessage(`Role for ${user.name} changed to ${targetRole.toUpperCase()}.`);
      setRoleChangeTarget(null);
    } catch (err: any) {
      console.error("Role change failed:", err);
      setError(err.message || "Failed to change role.");
    } finally {
      setChangingRole(false);
    }
  }

  // Handlers for Deactivate / Reactivate
  function requestStatusChange(u: AppUser, targetActive: boolean) {
    if (u.uid === profile?.uid && !targetActive) {
      setError("You cannot deactivate your own account.");
      return;
    }

    if (!targetActive && u.role === "auditor" && activeAuditorsCount <= 1) {
      setError("Cannot deactivate the only remaining active auditor. At least one auditor must remain active.");
      return;
    }

    setStatusChangeTarget({ user: u, targetActive });
  }

  async function confirmStatusChange() {
    if (!statusChangeTarget || !profile) return;
    const { user, targetActive } = statusChangeTarget;

    setChangingStatus(true);
    setError("");

    try {
      await setUserActiveStatus(user.uid, targetActive, {
        uid: profile.uid,
        email: profile.email,
        name: profile.name,
      });

      setUsers((prev) =>
        prev.map((u) =>
          u.uid === user.uid
            ? {
                ...u,
                isActive: targetActive,
                status: targetActive ? "active" : "inactive",
                updatedAt: Date.now(),
              }
            : u
        )
      );

      setSuccessMessage(
        `User ${user.name} was successfully ${targetActive ? "reactivated" : "deactivated"}.`
      );
      setStatusChangeTarget(null);
    } catch (err: any) {
      console.error("Status change failed:", err);
      setError(err.message || "Failed to change account status.");
    } finally {
      setChangingStatus(false);
    }
  }

  // Handlers for Exam Assignment Revocation
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

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 py-6">
        <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
        <span>Loading users directory...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Banner Notifications */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {successMessage && (
        <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 p-3.5 text-sm text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
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

      {/* Action Header & Search / Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          {/* Search Box */}
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              className="input pl-9 text-xs sm:text-sm w-full"
              placeholder="Search by name, email, batch..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Role Filter */}
          <select
            className="input text-xs h-9"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
          >
            <option value="all">All Roles</option>
            <option value="agent">Agents Only</option>
            <option value="auditor">Auditors Only</option>
          </select>

          {/* Status Filter */}
          <select
            className="input text-xs h-9"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>

          <span className="text-xs text-slate-400 ml-1">
            {filteredUsers.length} user{filteredUsers.length === 1 ? "" : "s"}
          </span>
        </div>

        {/* Add User Action Button */}
        <div>
          <button
            type="button"
            className="btn-primary text-xs flex items-center gap-1.5 shadow-sm whitespace-nowrap"
            onClick={() => {
              setAddError("");
              setCreatedUserInfo(null);
              setAddForm({
                name: "",
                email: "",
                role: "agent",
                password: "",
                batch: "",
                streamId: "",
              });
              setShowAddModal(true);
            }}
          >
            <UserPlus className="h-4 w-4" />
            <span>Add User</span>
          </button>
        </div>
      </div>

      {/* Main Users Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800">
              <tr>
                <th className="p-3 w-8"></th>
                <th className="p-3">User</th>
                <th className="p-3">Email</th>
                <th className="p-3">Role</th>
                <th className="p-3">Status</th>
                <th className="p-3">Active Tests</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-xs text-slate-400">
                    No users found matching current filters.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isAgent = u.role === "agent";
                  const activeExams = activeExamsByAgent.get(u.uid) || [];
                  const isExpanded = expandedUser === u.uid;
                  const isActive = u.isActive !== false;
                  const isSelf = u.uid === profile?.uid;

                  return (
                    <tr
                      key={u.uid}
                      className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/30 ${
                        !isActive ? "opacity-60 bg-slate-50/30 dark:bg-slate-900/20" : ""
                      }`}
                    >
                      <td className="p-3 text-center">
                        {isAgent && activeExams.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => setExpandedUser(isExpanded ? null : u.uid)}
                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            title={isExpanded ? "Collapse assignments" : "Expand active assignments"}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                        ) : null}
                      </td>

                      <td className="p-3 font-medium text-slate-900 dark:text-slate-100">
                        <div className="flex items-center gap-2">
                          {u.role === "auditor" ? (
                            <Shield className="h-4 w-4 text-brand-600 shrink-0" />
                          ) : (
                            <User className="h-4 w-4 text-slate-400 shrink-0" />
                          )}
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span>{u.name}</span>
                              {isSelf && (
                                <span className="rounded bg-brand-100 px-1.5 py-0.2 text-[10px] font-bold text-brand-700 dark:bg-brand-950 dark:text-brand-300">
                                  You
                                </span>
                              )}
                            </div>
                            {u.batch && (
                              <p className="text-[11px] text-slate-400">Batch: {u.batch}</p>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="p-3 text-slate-500 text-xs sm:text-sm">{u.email}</td>

                      <td className="p-3">
                        <Badge color={u.role === "auditor" ? "brand" : "slate"}>
                          {u.role}
                        </Badge>
                      </td>

                      <td className="p-3">
                        <Badge color={isActive ? "green" : "red"}>
                          {isActive ? "Active" : "Inactive"}
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
                              <span>{isExpanded ? "Hide" : "Manage"}</span>
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">None</span>
                          )
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>

                      <td className="p-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {/* Edit Details */}
                          <button
                            type="button"
                            className="rounded-lg border border-slate-200 bg-white p-1 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                            onClick={() => startEditingUser(u)}
                            title="Edit User Info"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>

                          {/* Toggle Role Button */}
                          <button
                            type="button"
                            className="btn-secondary text-[11px] py-1 px-2"
                            onClick={() => requestRoleChange(u)}
                            title={`Change role to ${u.role === "auditor" ? "Agent" : "Auditor"}`}
                          >
                            Make {u.role === "auditor" ? "Agent" : "Auditor"}
                          </button>

                          {/* Deactivate / Reactivate Button */}
                          {isActive ? (
                            <button
                              type="button"
                              disabled={isSelf || (u.role === "auditor" && activeAuditorsCount <= 1)}
                              className="rounded-lg border border-red-200 bg-white p-1 text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:hover:bg-white dark:border-red-900/40 dark:bg-slate-800 dark:text-red-400"
                              onClick={() => requestStatusChange(u, false)}
                              title={
                                isSelf
                                  ? "You cannot deactivate your own account"
                                  : u.role === "auditor" && activeAuditorsCount <= 1
                                  ? "Cannot deactivate the only active auditor"
                                  : "Deactivate user"
                              }
                            >
                              <UserX className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="rounded-lg border border-green-200 bg-white p-1 text-green-600 hover:bg-green-50 dark:border-green-800 dark:bg-slate-800 dark:text-green-400"
                              onClick={() => requestStatusChange(u, true)}
                              title="Reactivate user"
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Expanded Active Assignments Drawer */}
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

      {/* ADD USER MODAL */}
      <Modal
        open={showAddModal}
        onClose={() => {
          if (!addingUser) setShowAddModal(false);
        }}
        title="Add New User"
      >
        {createdUserInfo ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-xs text-green-900 dark:border-green-800 dark:bg-green-950/30 dark:text-green-200">
              <div className="flex items-center gap-2 mb-2 font-bold text-sm text-green-950 dark:text-green-100">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <span>User Account Created Successfully!</span>
              </div>
              <p>
                <strong>Name:</strong> {createdUserInfo.user.name}
              </p>
              <p className="mt-1">
                <strong>Email:</strong> {createdUserInfo.user.email}
              </p>
              <p className="mt-1">
                <strong>Role:</strong> {createdUserInfo.user.role.toUpperCase()}
              </p>

              {createdUserInfo.tempPassword && (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-[11px] uppercase tracking-wider flex items-center gap-1">
                      <Key className="h-3.5 w-3.5" /> Initial Password
                    </span>
                    <button
                      type="button"
                      className="text-xs text-brand-600 hover:underline flex items-center gap-1 font-semibold"
                      onClick={() => {
                        navigator.clipboard.writeText(createdUserInfo.tempPassword!);
                        alert("Password copied to clipboard!");
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </button>
                  </div>
                  <code className="mt-1 block font-mono font-bold text-sm select-all">
                    {createdUserInfo.tempPassword}
                  </code>
                  <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">
                    Provide this temporary password to the user. They can sign in immediately.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => {
                  setCreatedUserInfo(null);
                  setShowAddModal(false);
                }}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleAddUserSubmit} className="space-y-4">
            {addError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                <span>{addError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                Full Name *
              </label>
              <input
                type="text"
                required
                className="input text-sm w-full"
                placeholder="e.g. Jane Doe"
                value={addForm.name}
                onChange={(e) => setAddForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                Email Address *
              </label>
              <input
                type="email"
                required
                className="input text-sm w-full"
                placeholder="agent@company.com"
                value={addForm.email}
                onChange={(e) => setAddForm((prev) => ({ ...prev, email: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                  Role *
                </label>
                <select
                  className="input text-sm w-full"
                  value={addForm.role}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, role: e.target.value as UserRole }))}
                >
                  <option value="agent">Agent</option>
                  <option value="auditor">Auditor</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                  Batch / Group
                </label>
                <input
                  type="text"
                  className="input text-sm w-full"
                  placeholder="e.g. Batch 12"
                  value={addForm.batch}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, batch: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                Initial Password (Optional)
              </label>
              <input
                type="text"
                className="input text-sm w-full"
                placeholder="Leave blank to generate secure password"
                value={addForm.password}
                onChange={(e) => setAddForm((prev) => ({ ...prev, password: e.target.value }))}
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Minimum 6 characters. If left empty, an auto-generated temporary password will be created.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setShowAddModal(false)}
                disabled={addingUser}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary text-xs flex items-center gap-1.5"
                disabled={addingUser}
              >
                {addingUser ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Creating User...</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>Create User</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* EDIT USER MODAL */}
      {editingUser && (
        <Modal
          open={!!editingUser}
          onClose={() => {
            if (!savingEdit) setEditingUser(null);
          }}
          title={`Edit User — ${editingUser.name}`}
        >
          <form onSubmit={handleSaveUserEdit} className="space-y-4">
            {editError && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-300 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                <span>{editError}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                Full Name *
              </label>
              <input
                type="text"
                required
                className="input text-sm w-full"
                value={editForm.name}
                onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                Email Address
              </label>
              <input
                type="email"
                disabled
                className="input text-sm w-full bg-slate-100 dark:bg-slate-800 cursor-not-allowed text-slate-500"
                value={editingUser.email}
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Email addresses are bound to primary authentication credentials.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                  Batch / Group
                </label>
                <input
                  type="text"
                  className="input text-sm w-full"
                  placeholder="e.g. Batch 12"
                  value={editForm.batch}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, batch: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-600 dark:text-slate-300 mb-1">
                  Stream ID
                </label>
                <input
                  type="text"
                  className="input text-sm w-full"
                  placeholder="e.g. training-stream-1"
                  value={editForm.streamId}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, streamId: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setEditingUser(null)}
                disabled={savingEdit}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary text-xs flex items-center gap-1.5"
                disabled={savingEdit}
              >
                {savingEdit ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save Changes</span>
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ROLE CHANGE CONFIRMATION MODAL */}
      {roleChangeTarget && (
        <Modal
          open={!!roleChangeTarget}
          onClose={() => {
            if (!changingRole) setRoleChangeTarget(null);
          }}
          title="Confirm Role Change"
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200 flex items-start gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div>
                <p className="font-semibold text-sm text-amber-950 dark:text-amber-100">
                  Change role for {roleChangeTarget.user.name}?
                </p>
                <p className="mt-1">
                  Current Role: <Badge color="slate">{roleChangeTarget.user.role}</Badge>
                </p>
                <p className="mt-1">
                  New Role: <Badge color="brand">{roleChangeTarget.targetRole}</Badge>
                </p>
                {roleChangeTarget.targetRole === "auditor" ? (
                  <p className="mt-2 text-slate-600 dark:text-slate-400">
                    Granting auditor privileges allows this user to build exams, review agent attempts, evaluate AI gradings, and view performance analytics.
                  </p>
                ) : (
                  <p className="mt-2 text-slate-600 dark:text-slate-400">
                    Demoting this user to agent will revoke access to exam building, grading reviews, analytics, and administrative management.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setRoleChangeTarget(null)}
                disabled={changingRole}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary text-xs flex items-center gap-1.5"
                onClick={confirmRoleChange}
                disabled={changingRole}
              >
                {changingRole ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Updating Role...</span>
                  </>
                ) : (
                  <span>Confirm Role Change</span>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* DEACTIVATE / REACTIVATE CONFIRMATION MODAL */}
      {statusChangeTarget && (
        <Modal
          open={!!statusChangeTarget}
          onClose={() => {
            if (!changingStatus) setStatusChangeTarget(null);
          }}
          title={statusChangeTarget.targetActive ? "Reactivate User Account" : "Deactivate User Account"}
        >
          <div className="space-y-4">
            <div
              className={`rounded-xl border p-3.5 text-xs flex items-start gap-2.5 ${
                statusChangeTarget.targetActive
                  ? "border-green-200 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/30 dark:text-green-200"
                  : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
              }`}
            >
              {statusChangeTarget.targetActive ? (
                <UserCheck className="h-5 w-5 shrink-0 text-green-600 mt-0.5" />
              ) : (
                <UserX className="h-5 w-5 shrink-0 text-red-600 mt-0.5" />
              )}
              <div>
                <p className="font-semibold text-sm">
                  {statusChangeTarget.targetActive
                    ? `Reactivate account for ${statusChangeTarget.user.name}?`
                    : `Deactivate account for ${statusChangeTarget.user.name}?`}
                </p>
                <p className="mt-1">
                  Email: <strong>{statusChangeTarget.user.email}</strong>
                </p>
                {!statusChangeTarget.targetActive ? (
                  <div className="mt-2 space-y-1 text-slate-700 dark:text-slate-300">
                    <p>
                      • This user will immediately be blocked from logging in or taking exams.
                    </p>
                    <p className="font-medium text-emerald-700 dark:text-emerald-400">
                      • All historical completed attempts, scores, reviews, and reports will remain completely safe and intact.
                    </p>
                    <p>
                      • You can reactivate this account at any time in the future.
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-slate-600 dark:text-slate-400">
                    Reactivating will restore login access and allow assigning future exams to this user.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setStatusChangeTarget(null)}
                disabled={changingStatus}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-50 ${
                  statusChangeTarget.targetActive
                    ? "bg-emerald-600 hover:bg-emerald-700"
                    : "bg-red-600 hover:bg-red-700"
                }`}
                onClick={confirmStatusChange}
                disabled={changingStatus}
              >
                {changingStatus ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : statusChangeTarget.targetActive ? (
                  <>
                    <UserCheck className="h-3.5 w-3.5" />
                    <span>Confirm Reactivate</span>
                  </>
                ) : (
                  <>
                    <UserX className="h-3.5 w-3.5" />
                    <span>Confirm Deactivate</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* REVOCATION MODAL FOR ASSIGNMENTS */}
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
