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

async function listDocs(col: string) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${col}?pageSize=300`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  return (data.documents || []).map((d: any) => ({
    id: d.name.split("/").pop(),
    ...fromFirestore(d.fields || {})
  }));
}

async function main() {
  const attempts = await listDocs("attempts");
  console.log(`Analyzing ${attempts.length} attempts in Firestore...`);

  // Check 1: Any attempt where startedAt == submittedAt or timeTakenSeconds is 0 or undefined but answers exist
  const suspicious = [];
  for (const a of attempts) {
    const isReattempt = a.isReattempt || a.attemptNumber > 1;
    const ansCount = Object.keys(a.agentAnswers || {}).length;
    const arrayAnsCount = (a.answers || []).filter((ans: any) => ans.agentAnswer && ans.agentAnswer.trim().length > 0).length;

    // Check if any reattempt has identical answers to its parentAttemptId
    let identicalToParent = false;
    if (a.parentAttemptId) {
      const parent = attempts.find((p: any) => p.id === a.parentAttemptId);
      if (parent) {
        let sameCount = 0;
        for (const [qid, ans] of Object.entries(a.agentAnswers || {})) {
          const parentAns = (parent.agentAnswers || {})[qid] || (parent.answers || []).find((x: any) => x.questionId === qid)?.agentAnswer;
          if (parentAns && parentAns === ans) {
            sameCount++;
          }
        }
        if (sameCount > 0 && sameCount === ansCount) {
          identicalToParent = true;
        }
      }
    }

    if (identicalToParent) {
      suspicious.push({
        id: a.id,
        agentId: a.agentId,
        examId: a.examId,
        attemptNumber: a.attemptNumber,
        status: a.status,
        timeTakenSeconds: a.timeTakenSeconds,
        reason: "IDENTICAL_TO_PARENT_ATTEMPT"
      });
    }

    // Check if in_progress or unsubmitted attempt has answers
    if (a.status === "in_progress" && (ansCount > 0 || arrayAnsCount > 0)) {
      console.log(`In-progress attempt with answers: ID=${a.id} Agent=${a.agentId} AnsCount=${ansCount}`);
    }
  }

  console.log(`Identical to parent attempts:`, suspicious);

  // Check all reattempt records across all agents
  const reattempts = attempts.filter((a: any) => a.attemptNumber > 1 || a.isReattempt);
  console.log(`Total reattempts: ${reattempts.length}`);
  for (const r of reattempts) {
    const parent = attempts.find((p: any) => p.id === r.parentAttemptId);
    console.log(`Reattempt ${r.id}: Status=${r.status} Number=${r.attemptNumber} Time=${r.timeTakenSeconds}s AgentAnswersCount=${Object.keys(r.agentAnswers || {}).length}`);
  }
}

main().catch(console.error);
