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

const PROJECT_ID = (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "moodle-adf67").replace(/"/g, "");

async function getAdminToken(): Promise<string> {
  const homeDir = process.env.USERPROFILE || process.env.HOME || "";
  const configPath = path.join(homeDir, ".config", "configstore", "firebase-tools.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return config.tokens.access_token;
}

async function checkAttemptsForExam(examId: string) {
  const token = await getAdminToken();
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "attempts" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "examId" },
              op: "EQUAL",
              value: { stringValue: examId },
            },
          },
        },
      }),
    }
  );

  const data = await res.json();
  const docs = (data || []).map((item: any) => item.document).filter(Boolean);
  console.log(`Found ${docs.length} attempts for exam ${examId}`);
  for (const d of docs) {
    console.log("Attempt:", d.name.split("/").pop());
  }
}

checkAttemptsForExam("ZwQL2eQqAFVLxqK5UHVH").catch(console.error);
