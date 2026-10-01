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

  const examsRes = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/exams?pageSize=100`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const examsData = await examsRes.json();
  const exams = (examsData.documents || []).map((d: any) => ({
    id: d.name.split("/").pop(),
    ...fromFirestore(d.fields),
  }));

  console.log(`Auditing ${exams.length} exams...\n`);

  for (const e of exams as any[]) {
    console.log(`==================================================`);
    console.log(`Exam ID: ${e.id}`);
    console.log(`Name: ${e.name}`);
    console.log(`Status: ${e.status}`);
    console.log(`Created By: ${e.createdBy}`);
    console.log(`Mode: ${e.mode}`);
    console.log(`Assigned Agent IDs (${(e.assignedAgentIds || []).length}):`, e.assignedAgentIds);
    console.log(`Questions count: ${(e.questions || []).length}`);
    console.log(`Keys on exam doc:`, Object.keys(e));
    if (e.reattemptPermissions) {
      console.log(`Reattempt permissions keys:`, Object.keys(e.reattemptPermissions));
    }
  }
}

main().catch(console.error);
