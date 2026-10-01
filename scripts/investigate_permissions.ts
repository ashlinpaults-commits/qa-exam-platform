import fs from "fs";
import path from "path";

// Read .env.local
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        process.env[key] = val;
      }
    }
  }
}

function decodeValue(v: Record<string, any>): any {
  if (!v || typeof v !== "object") return v;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return parseInt(v.integerValue, 10);
  if ("doubleValue" in v) return parseFloat(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("mapValue" in v) return fromFirestore(v.mapValue.fields);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  return undefined;
}

function fromFirestore<T = Record<string, unknown>>(fields: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    result[k] = decodeValue(v as Record<string, any>);
  }
  return result as T;
}

const PROJECT_ID = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "moodle-adf67").replace(/"/g, "");

async function getAdminToken(): Promise<string> {
  const homeDir = process.env.USERPROFILE || process.env.HOME || "";
  const configPath = path.join(homeDir, ".config", "configstore", "firebase-tools.json");
  if (!fs.existsSync(configPath)) {
    throw new Error("No firebase-tools.json found");
  }
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const tokens = config.tokens;
  return tokens.access_token;
}

async function main() {
  const token = await getAdminToken();

  // 1. Fetch all users
  const usersRes = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users?pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const usersData = await usersRes.json();
  const users = (usersData.documents || []).map((d: any) => ({
    id: d.name.split("/").pop(),
    ...fromFirestore(d.fields),
  }));
  console.log("=== USERS ===");
  console.log(`Found ${users.length} users.`);
  for (const u of users) {
    console.log(`User: ${u.id} | name: ${(u as any).name} | role: ${(u as any).role} | email: ${(u as any).email}`);
  }

  // 2. Fetch all exams
  const examsRes = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/exams?pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const examsData = await examsRes.json();
  const exams = (examsData.documents || []).map((d: any) => ({
    id: d.name.split("/").pop(),
    ...fromFirestore(d.fields),
  }));

  console.log("\n=== EXAMS ===");
  console.log(`Found ${exams.length} exams.`);
  for (const e of exams as any[]) {
    console.log({
      id: e.id,
      name: e.name,
      status: e.status,
      mode: e.mode,
      createdBy: e.createdBy,
      assignedAgentIds: e.assignedAgentIds,
      assignedCount: Array.isArray(e.assignedAgentIds) ? e.assignedAgentIds.length : 0,
      questionsCount: Array.isArray(e.questions) ? e.questions.length : 0,
      hasQuestionSnapshots: Boolean(e.questionSnapshots && Object.keys(e.questionSnapshots).length > 0),
      hasReattemptPermissions: Boolean(e.reattemptPermissions && Object.keys(e.reattemptPermissions).length > 0),
    });
  }

  // 3. Check assignments
  const asgRes = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/assignments?pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const asgData = await asgRes.json();
  const assignments = (asgData.documents || []).map((d: any) => ({
    id: d.name.split("/").pop(),
    ...fromFirestore(d.fields),
  }));
  console.log(`\nFound ${assignments.length} assignments.`);
  for (const a of assignments as any[]) {
    console.log(`Assignment: ${a.id} | examId: ${a.examId} | agentId: ${a.agentId} | status: ${a.status} | attemptNumber: ${a.attemptNumber} | type: ${a.assignmentType}`);
  }
}

main().catch(console.error);
