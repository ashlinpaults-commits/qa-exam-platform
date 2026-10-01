import fs from "fs";
import path from "path";

const p = path.join(process.env.USERPROFILE!, ".config", "configstore", "firebase-tools.json");
const d = JSON.parse(fs.readFileSync(p, "utf8"));
const token = d.tokens.access_token;
const PROJECT_ID = "moodle-adf67";

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

async function getDoc(col: string, id: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${col}/${id}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { id, ...fromFirestore(data.fields || {}) };
}

async function listDocs(col: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${col}?pageSize=300`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.documents || []).map((d: any) => ({
    id: d.name.split("/").pop(),
    ...fromFirestore(d.fields || {})
  }));
}

async function main() {
  const agentId = "0WCtZLLiTAZvq8Ne0eQ2xmTlo3q1";
  const examId = "UGuHTZUETzlN6e6g327p";

  const assignments = await listDocs("assignments");
  const anaghaAsg = assignments.filter((a: any) => a.agentId === agentId && a.examId === examId);
  console.log("=== ASSIGNMENTS FOR ANAGHA ON TEST 8 ===");
  console.log(JSON.stringify(anaghaAsg, null, 2));

  const attempts = await listDocs("attempts");
  const anaghaAtt = attempts.filter((a: any) => a.agentId === agentId && a.examId === examId);
  console.log("=== ATTEMPTS FOR ANAGHA ON TEST 8 ===");
  for (const att of anaghaAtt) {
    console.log(`\nAttempt ID: ${att.id}`);
    console.log(`  attemptNumber: ${att.attemptNumber}`);
    console.log(`  status: ${att.status}`);
    console.log(`  startedAt: ${att.startedAt} (${new Date(att.startedAt).toISOString()})`);
    console.log(`  submittedAt: ${att.submittedAt} (${att.submittedAt ? new Date(att.submittedAt).toISOString() : 'none'})`);
    console.log(`  timeTakenSeconds: ${att.timeTakenSeconds}`);
    console.log(`  agentAnswers keys:`, Object.keys(att.agentAnswers || {}));
    if (att.agentAnswers) {
      for (const [k, v] of Object.entries(att.agentAnswers)) {
        console.log(`    [agentAnswers] ${k}: "${v}"`);
      }
    }
    console.log(`  answers count: ${att.answers?.length}`);
    for (const ans of att.answers || []) {
      if (ans.questionId === "SJ0PaHESxGomkrwRyWwA" || ans.questionId === "kyoCPMiWwQ6iTcf6uqD7") {
        console.log(`    [answers array] ${ans.questionId}: agentAnswer="${ans.agentAnswer}" marks=${ans.marks}/${ans.maxMarks}`);
      }
    }
  }

  // Also check if there are other attempts or assignments for Anagha
  console.log("\n=== ALL ATTEMPTS FOR ANAGHA (ANY EXAM) ===");
  const allAnaghaAtt = attempts.filter((a: any) => a.agentId === agentId);
  for (const a of allAnaghaAtt) {
    console.log(`Exam: ${a.examId} | Attempt #${a.attemptNumber} | ID: ${a.id} | Status: ${a.status} | Started: ${new Date(a.startedAt).toISOString()}`);
  }
}

main().catch(console.error);
