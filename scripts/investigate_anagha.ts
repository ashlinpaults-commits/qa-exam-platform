import fs from "fs";
import path from "path";

// Read .env.local synchronously first
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

  // Check if expired
  if (tokens.expires_at && Date.now() < tokens.expires_at - 60000 && tokens.access_token) {
    return tokens.access_token;
  }

  return tokens.access_token;
}

async function queryCollection(token: string, col: string): Promise<any[]> {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${col}?pageSize=300`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to query ${col}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  if (!data.documents) return [];
  return data.documents.map((d: any) => {
    const id = d.name.split("/").pop();
    const parsed = fromFirestore(d.fields || {});
    return { id, ...(parsed as any) };
  });
}

async function main() {
  const token = await getAdminToken();
  console.log("Admin token obtained. Fetching users, exams, assignments, attempts...");

  const users = await queryCollection(token, "users");
  console.log(`Found ${users.length} users.`);
  const anagha = users.find((u: any) =>
    (u.name && u.name.toLowerCase().includes("anagha")) ||
    (u.email && u.email.toLowerCase().includes("anagha"))
  );
  console.log("Target user (Anagha):", anagha);

  const exams = await queryCollection(token, "exams");
  console.log(`Found ${exams.length} exams.`);
  const test8 = exams.find((e: any) =>
    (e.name && e.name.toLowerCase().includes("test 8")) ||
    (e.id && e.id.toLowerCase().includes("test-8")) ||
    (e.id && e.id.toLowerCase().includes("test_8"))
  );
  console.log("Target exam (Test 8):", test8 ? { id: test8.id, name: test8.name } : "Not found");

  if (!anagha) {
    console.log("All user names:", users.map((u: any) => ({ id: u.id, name: u.name, email: u.email })));
  }
  if (!test8) {
    console.log("All exam names:", exams.map((e: any) => ({ id: e.id, name: e.name })));
  }

  const agentId = anagha?.uid || anagha?.id;
  const examId = test8?.id;

  const assignments = await queryCollection(token, "assignments");
  console.log(`Found ${assignments.length} total assignments.`);
  const anaghaAssignments = assignments.filter((a: any) =>
    (!agentId || a.agentId === agentId) && (!examId || a.examId === examId)
  );
  console.log(`Assignments for Anagha/Test 8:`, JSON.stringify(anaghaAssignments, null, 2));

  const attempts = await queryCollection(token, "attempts");
  console.log(`Found ${attempts.length} total attempts.`);
  const anaghaAttempts = attempts.filter((a: any) =>
    (!agentId || a.agentId === agentId) && (!examId || a.examId === examId)
  );
  console.log(`Attempts for Anagha/Test 8:`, JSON.stringify(anaghaAttempts, null, 2));
}

main().catch(console.error);
