import fs from "fs";
import path from "path";

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

  console.log("Auditing exams for anomalies:\n");

  for (const e of exams as any[]) {
    const issues: string[] = [];
    if (!e.createdBy) issues.push("MISSING createdBy");
    if (!e.status) issues.push("MISSING status");
    if (e.status !== "published" && e.status !== "active") issues.push(`NON-ACTIVE STATUS: "${e.status}"`);
    if (!Array.isArray(e.assignedAgentIds)) issues.push("assignedAgentIds is not array");
    if (!Array.isArray(e.questions)) issues.push("questions is not array");
    if (e.assignedAgentIds && e.assignedAgentIds.some((id: any) => typeof id !== "string")) {
      issues.push("assignedAgentIds has non-string elements");
    }

    if (issues.length > 0) {
      console.log(`Exam: ${e.name} (${e.id})`);
      console.log(`  Issues: ${issues.join("; ")}`);
    }
  }
}

main().catch(console.error);
