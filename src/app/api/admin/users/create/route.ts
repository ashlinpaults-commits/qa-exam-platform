import { NextResponse } from "next/server";
import {
  verifyFirebaseIdToken,
  getServerAdminToken,
  toFirestore,
} from "@/lib/server/auth";
import type { UserRole } from "@/types";

const API_KEY = (process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyAtZMQx1rFDqEwSWgnGAeuBFetusxhFwag").replace(/"/g, "");
const PROJECT_ID = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "moodle-adf67").replace(/"/g, "");

function generateTemporaryPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%";
  let pwd = "";
  for (let i = 0; i < 12; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
}

export async function POST(request: Request) {
  try {
    // 1. Authenticate caller and verify auditor role
    const authHeader = request.headers.get("authorization");
    const authUser = await verifyFirebaseIdToken(authHeader);

    if (!authUser) {
      return NextResponse.json(
        { error: "Unauthorized: A valid Firebase ID token is required." },
        { status: 401 }
      );
    }

    if (authUser.role !== "auditor") {
      return NextResponse.json(
        { error: "Forbidden: Only authorized auditors may create user accounts." },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { email, name, role, password, batch, streamId } = body;

    // 2. Validate input fields
    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 }
      );
    }

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return NextResponse.json(
        { error: "User full name is required (minimum 2 characters)." },
        { status: 400 }
      );
    }

    const assignedRole: UserRole = role === "auditor" ? "auditor" : "agent";
    if (role && role !== "agent" && role !== "auditor") {
      return NextResponse.json(
        { error: `Invalid role: "${role}". Only "agent" and "auditor" are supported.` },
        { status: 400 }
      );
    }

    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();
    const finalPassword = password && typeof password === "string" && password.trim().length >= 6
      ? password.trim()
      : generateTemporaryPassword();

    // 3. Create Firebase Auth user via Google Identity Toolkit REST API
    const signUpUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`;
    const signUpRes = await fetch(signUpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: trimmedEmail,
        password: finalPassword,
        returnSecureToken: true,
      }),
    });

    const signUpData = await signUpRes.json();

    if (!signUpRes.ok) {
      const errorMsg = signUpData?.error?.message || "Failed to create authentication account.";
      if (errorMsg.includes("EMAIL_EXISTS")) {
        return NextResponse.json(
          { error: "An account with this email address already exists." },
          { status: 400 }
        );
      }
      return NextResponse.json(
        { error: `Authentication service error: ${errorMsg}` },
        { status: 400 }
      );
    }

    const newUid = signUpData.localId;
    const now = Date.now();
    const userToken = authHeader!.replace(/^Bearer\s+/i, "").trim();
    const adminToken = getServerAdminToken();
    const primaryToken = adminToken || userToken;

    // 4. Create Firestore user document in users/{uid}
    const userDocUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${newUid}`;
    const userPayload = toFirestore({
      uid: newUid,
      email: trimmedEmail,
      name: trimmedName,
      role: assignedRole,
      isActive: true,
      status: "active",
      batch: typeof batch === "string" ? batch.trim() : "",
      streamId: typeof streamId === "string" ? streamId.trim() : "",
      createdAt: now,
      updatedAt: now,
    });

    let docRes = await fetch(userDocUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${primaryToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(userPayload),
    });

    if (!docRes.ok && adminToken && userToken && userToken !== adminToken) {
      docRes = await fetch(userDocUrl, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${userToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(userPayload),
      });
    }

    // 5. Create audit log entry
    try {
      const auditLogUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/audit_logs`;
      const auditPayload = toFirestore({
        action: "USER_CREATED",
        actorId: authUser.uid,
        actorEmail: authUser.email,
        targetId: newUid,
        targetName: trimmedName,
        details: {
          email: trimmedEmail,
          name: trimmedName,
          role: assignedRole,
          batch: batch || "",
          streamId: streamId || "",
        },
        timestamp: now,
      });

      await fetch(auditLogUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${primaryToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(auditPayload),
      });
    } catch (auditErr) {
      console.warn("[api/admin/users/create] Could not write audit log:", auditErr);
    }

    return NextResponse.json({
      success: true,
      user: {
        uid: newUid,
        email: trimmedEmail,
        name: trimmedName,
        role: assignedRole,
        isActive: true,
        status: "active",
        createdAt: now,
      },
      temporaryPassword: finalPassword,
      message: `User ${trimmedName} (${trimmedEmail}) successfully created with role ${assignedRole}.`,
    });
  } catch (err: any) {
    console.error("[api/admin/users/create] Server error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal server error occurred while creating user." },
      { status: 500 }
    );
  }
}
