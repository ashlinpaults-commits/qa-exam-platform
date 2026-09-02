"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import {
  fetchUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
} from "@/lib/notifications";
import type { AppNotification } from "@/types";
import {
  ShieldCheck,
  LogOut,
  Bell,
  BookOpen,
  FileCheck,
} from "lucide-react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const router = useRouter();

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!profile?.uid) return;

    let mounted = true;
    fetchUserNotifications(profile.uid).then((data) => {
      if (mounted) setNotifications(data);
    });

    return () => {
      mounted = false;
    };
  }, [profile?.uid]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function handleNotificationClick(notif: AppNotification) {
    if (!notif.read) {
      await markNotificationAsRead(notif.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
      );
    }
    setOpen(false);
    if (notif.link) {
      router.push(notif.link);
    }
  }

  async function handleMarkAllRead() {
    if (!profile?.uid) return;
    await markAllNotificationsAsRead(profile.uid);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  function formatTimeAgo(timestamp: number) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <div className="min-h-screen bg-surface dark:bg-surface-dark">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-100 bg-white/80 px-6 py-3 backdrop-blur dark:border-slate-800 dark:bg-surface-dark/80">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-5 w-5 text-brand-600" />
          QA Exam Platform
        </div>
        <div className="flex items-center gap-4">
          {/* In-App Notification Bell */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              className="relative rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              onClick={() => setOpen(!open)}
              title="Notifications"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {/* Notification Dropdown */}
            {open && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 z-50 overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-sm text-slate-900 dark:text-white">
                      Notifications
                    </h4>
                    {unreadCount > 0 && (
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-600 dark:bg-brand-900/40 dark:text-brand-300">
                        {unreadCount} new
                      </span>
                    )}
                  </div>

                  {unreadCount > 0 && (
                    <button
                      type="button"
                      className="text-xs text-brand-600 hover:underline dark:text-brand-400"
                      onClick={handleMarkAllRead}
                    >
                      Mark all read
                    </button>
                  )}
                </div>

                <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
                  {notifications.length === 0 ? (
                    <div className="py-8 text-center text-sm text-slate-400">
                      <Bell className="mx-auto mb-2 h-6 w-6 text-slate-300 dark:text-slate-600" />
                      No notifications yet.
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        onClick={() => handleNotificationClick(notif)}
                        className={`flex cursor-pointer items-start gap-3 p-3.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                          !notif.read
                            ? "bg-brand-50/40 dark:bg-brand-950/20"
                            : ""
                        }`}
                      >
                        <div
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                            notif.type === "exam_assigned"
                              ? "bg-blue-100 text-blue-600 dark:bg-blue-950/50"
                              : "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50"
                          }`}
                        >
                          {notif.type === "exam_assigned" ? (
                            <BookOpen className="h-4 w-4" />
                          ) : (
                            <FileCheck className="h-4 w-4" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <p
                              className={`text-xs font-medium truncate ${
                                !notif.read
                                  ? "font-semibold text-slate-900 dark:text-white"
                                  : "text-slate-700 dark:text-slate-300"
                              }`}
                            >
                              {notif.title}
                            </p>
                            <span className="text-[10px] text-slate-400 shrink-0">
                              {formatTimeAgo(notif.createdAt)}
                            </span>
                          </div>

                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                            {notif.message}
                          </p>
                        </div>

                        {!notif.read && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-600" />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{profile?.name}</p>
            <p className="capitalize text-slate-500">{profile?.role}</p>
          </div>
          <button
            className="btn-secondary"
            onClick={async () => {
              await signOut(auth);
              router.push("/login");
            }}
          >
            <LogOut className="mr-1 h-4 w-4" /> Sign out
          </button>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
