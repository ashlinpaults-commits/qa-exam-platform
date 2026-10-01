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
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return config.tokens.access_token;
}

async function main() {
  const token = await getAdminToken();

  // 1. Fetch all exams
  const examsRes = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/exams?pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const examsData = await examsRes.json();
  const exams = (examsData.documents || []).map((d: any) => ({
    id: d.name.split("/").pop(),
    ...fromFirestore(d.fields),
  }));

  // 2. Fetch all assignments
  const asgRes = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/assignments?pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const asgData = await asgRes.json();
  const assignments = (asgData.documents || []).map((d: any) => ({
    id: d.name.split("/").pop(),
    ...fromFirestore(d.fields),
  }));

  // 3. Fetch all attempts
  const attRes = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/attempts?pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const attData = await attRes.json();
  const attempts = (attData.documents || []).map((d: any) => ({
    id: d.name.split("/").pop(),
    ...fromFirestore(d.fields),
  }));

  console.log("==================================================");
  console.log("EXAM COMPARISON MATRIX");
  console.log("==================================================\n");

  for (const e of exams as any[]) {
    const examAttempts = attempts.filter((a: any) => a.examId === e.id);
    const examAssignments = assignments.filter((a: any) => a.examId === e.id);

    console.log(`[Exam: ${e.name}]`);
    console.log(`  id: ${e.id}`);
    console.log(`  status: ${e.status}`);
    console.log(`  mode: ${e.mode}`);
    console.log(`  createdBy: ${e.createdBy}`);
    console.log(`  assignedAgents (${(e.assignedAgentIds || []).length}):`, e.assignedAgentIds);
    console.log(`  attempts count: ${examAttempts.length}`);
    console.log(`  attempt statuses:`, Array.from(new Set(examAttempts.map((a: any) => a.status))));
    console.log(`  assignments count: ${examAssignments.length}`);
    console.log(`  assignment statuses:`, Array.from(new Set(examAssignments.map((a: any) => a.status))));
    console.log(`  hasReattemptPermissions:`, Boolean(e.reattemptPermissions && Object.keys(e.reattemptPermissions).length > 0));
    console.log(`  hasQuestionSnapshots:`, Boolean(e.questionSnapshots && Object.keys(e.questionSnapshots).length > 0));
    console.log(`  questionCount:`, (e.questions || []).length);
    console.log("--------------------------------------------------");
  }
}

main().catch(console.error);
