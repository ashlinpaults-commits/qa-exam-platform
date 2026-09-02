"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchAllUsers,
  setUserRole,
  updateUserName,
  setUserDeactivated,
  deleteUserProfile,
} from "@/lib/users";
import type { AppUser, UserRole } from "@/types";
import { Badge, EmptyState } from "@/components/ui/Primitives";
import { useAuth } from "@/context/AuthContext";
import {
  Search,
  Edit2,
  UserX,
  UserCheck,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
} from "lucide-react";

export function AdminUsersScreen() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Edit Name Modal State
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);
  const [editNameValue, setEditNameValue] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const data = await fetchAllUsers();
      setUsers(data);
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Failed to load users." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (statusFilter === "active" && u.deactivated) return false;
      if (statusFilter === "deactivated" && !u.deactivated) return false;
      if (q) {
        const name = (u.name || "").toLowerCase();
        const email = (u.email || "").toLowerCase();
        if (!name.includes(q) && !email.includes(q)) return false;
      }
      return true;
    });
  }, [users, search, roleFilter, statusFilter]);

  async function handleToggleRole(u: AppUser) {
    if (u.uid === profile?.uid) {
      if (
        !confirm(
          "You're about to change your own role, which may revoke your auditor permissions. Continue?"
        )
      )
        return;
    }
    const newRole: UserRole = u.role === "auditor" ? "agent" : "auditor";
    try {
      await setUserRole(u.uid, newRole);
      setUsers((prev) =>
        prev.map((user) => (user.uid === u.uid ? { ...user, role: newRole } : user))
      );
      setMessage({ type: "success", text: `Role updated to ${newRole} for ${u.name}.` });
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Failed to update role." });
    }
  }

  async function handleToggleDeactivate(u: AppUser) {
    if (u.uid === profile?.uid) {
      alert("You cannot deactivate your own account.");
      return;
    }
    const willDeactivate = !u.deactivated;
    const confirmed = confirm(
      willDeactivate
        ? `Deactivate ${u.name}? They will be blocked from accessing the platform until reactivated.`
        : `Reactivate ${u.name}? They will regain access to their assigned exams.`
    );
    if (!confirmed) return;

    try {
      await setUserDeactivated(u.uid, willDeactivate);
      setUsers((prev) =>
        prev.map((user) =>
          user.uid === u.uid
            ? { ...user, deactivated: willDeactivate, deactivatedAt: willDeactivate ? Date.now() : undefined }
            : user
        )
      );
      setMessage({
        type: "success",
        text: willDeactivate ? `${u.name} deactivated.` : `${u.name} reactivated.`,
      });
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Failed to update account status." });
    }
  }

  async function handleDeleteUser(u: AppUser) {
    if (u.uid === profile?.uid) {
      alert("You cannot delete your own account.");
      return;
    }
    const confirmed = confirm(
      `Permanently remove user profile for ${u.name} (${u.email})?\n\nThis will remove their user record from the system. (Historical completed attempt records will remain safe).`
    );
    if (!confirmed) return;

    try {
      await deleteUserProfile(u.uid);
      setUsers((prev) => prev.filter((user) => user.uid !== u.uid));
      setMessage({ type: "success", text: `User ${u.name} removed successfully.` });
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Failed to remove user." });
    }
  }

  function startEditName(u: AppUser) {
    setEditingUser(u);
    setEditNameValue(u.name);
  }

  async function saveEditName(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser || !editNameValue.trim()) return;
    setSavingEdit(true);

    try {
      const trimmed = editNameValue.trim();
      await updateUserName(editingUser.uid, trimmed);
      setUsers((prev) =>
        prev.map((user) => (user.uid === editingUser.uid ? { ...user, name: trimmed } : user))
      );
      setMessage({ type: "success", text: `Display name updated to "${trimmed}".` });
      setEditingUser(null);
    } catch (err) {
      console.error(err);
      setMessage({ type: "error", text: "Failed to update name." });
    } finally {
      setSavingEdit(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-400">Loading users...</p>;

  return (
    <div className="space-y-4">
      {message && (
        <div
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{message.text}</span>
        </div>
      )}

      {/* Filter / Search Bar */}
      <div className="card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search user name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="input w-auto"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="">All Roles</option>
            <option value="auditor">Auditors</option>
            <option value="agent">Agents</option>
          </select>
          <select
            className="input w-auto"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="deactivated">Deactivated Only</option>
          </select>
        </div>
        <div className="mt-2 text-xs text-slate-500">
          Showing <strong className="text-slate-700 dark:text-slate-200">{filteredUsers.length}</strong> of <strong className="text-slate-700 dark:text-slate-200">{users.length}</strong> total users
        </div>
      </div>

      {/* Users Table */}
      <div className="card overflow-hidden">
        {filteredUsers.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title="No users found"
              subtitle="Try clearing or adjusting your search filters."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800">
                <tr>
                  <th className="p-3.5">Name</th>
                  <th className="p-3.5">Email</th>
                  <th className="p-3.5">Role</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredUsers.map((u) => (
                  <tr key={u.uid} className="transition hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                    <td className="p-3.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-white">{u.name}</span>
                        <button
                          type="button"
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                          title="Edit display name"
                          onClick={() => startEditName(u)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="p-3.5 text-slate-500">{u.email}</td>
                    <td className="p-3.5">
                      <Badge color={u.role === "auditor" ? "brand" : "slate"}>
                        {u.role}
                      </Badge>
                    </td>
                    <td className="p-3.5">
                      {u.deactivated ? (
                        <Badge color="red">Deactivated</Badge>
                      ) : (
                        <Badge color="green">Active</Badge>
                      )}
                    </td>
                    <td className="p-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          className="btn-secondary px-2.5 py-1 text-xs"
                          onClick={() => handleToggleRole(u)}
                          title="Change user role"
                        >
                          Make {u.role === "auditor" ? "Agent" : "Auditor"}
                        </button>

                        <button
                          className={`btn-secondary px-2.5 py-1 text-xs ${
                            u.deactivated ? "text-green-600" : "text-amber-600"
                          }`}
                          onClick={() => handleToggleDeactivate(u)}
                          title={u.deactivated ? "Reactivate user account" : "Deactivate user account"}
                        >
                          {u.deactivated ? (
                            <span className="flex items-center gap-1">
                              <UserCheck className="h-3.5 w-3.5" /> Reactivate
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <UserX className="h-3.5 w-3.5" /> Deactivate
                            </span>
                          )}
                        </button>

                        <button
                          className="btn-secondary px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                          onClick={() => handleDeleteUser(u)}
                          title="Remove user record"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Display Name Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="font-semibold text-slate-900 dark:text-white">Edit Display Name</h3>
              <button
                type="button"
                className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => setEditingUser(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={saveEditName} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Email (Read-only)</label>
                <input className="input bg-slate-50 text-slate-500 dark:bg-slate-800" value={editingUser.email} disabled />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Display Name</label>
                <input
                  className="input"
                  value={editNameValue}
                  onChange={(e) => setEditNameValue(e.target.value)}
                  placeholder="Full name"
                  required
                  autoFocus
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setEditingUser(null)}
                  disabled={savingEdit}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex items-center gap-1.5" disabled={savingEdit}>
                  {savingEdit && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save Name
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
