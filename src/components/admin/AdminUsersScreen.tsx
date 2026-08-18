"use client";

import { useEffect, useState } from "react";
import { fetchAllUsers, setUserRole } from "@/lib/users";
import type { AppUser } from "@/types";
import { Badge } from "@/components/ui/Primitives";
import { useAuth } from "@/context/AuthContext";

export function AdminUsersScreen() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setUsers(await fetchAllUsers());
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleRole(u: AppUser) {
    if (u.uid === profile?.uid) {
      if (!confirm("You're about to change your own role, which may lock you out of this screen. Continue?")) return;
    }
    await setUserRole(u.uid, u.role === "auditor" ? "agent" : "auditor");
    load();
  }

  if (loading) return <p className="text-sm text-slate-400">Loading users...</p>;

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800">
          <tr>
            <th className="p-3">Name</th>
            <th className="p-3">Email</th>
            <th className="p-3">Role</th>
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.uid} className="border-t border-slate-100 dark:border-slate-700">
              <td className="p-3">{u.name}</td>
              <td className="p-3 text-slate-500">{u.email}</td>
              <td className="p-3"><Badge color={u.role === "auditor" ? "brand" : "slate"}>{u.role}</Badge></td>
              <td className="p-3">
                <button className="btn-secondary text-xs" onClick={() => toggleRole(u)}>
                  Make {u.role === "auditor" ? "Agent" : "Auditor"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
