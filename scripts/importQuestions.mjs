// One-time bulk import of the full question bank using Firebase Admin SDK.
// This bypasses client-side write limits and is the recommended way to load
// large seed files (the in-app Excel Import UI works too, but for 5000+ rows
// this script is faster and safer against rate limits/timeouts).
//
// Setup:
//   1. Firebase Console -> Project Settings -> Service Accounts -> Generate new private key
//   2. Save it as scripts/serviceAccountKey.json (already gitignored)
//   3. npm install firebase-admin xlsx --save-dev
//   4. node scripts/importQuestions.mjs ./path/to/Questions.xlsx
//
import admin from "firebase-admin";
import XLSX from "xlsx";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serviceAccountPath = path.join(__dirname, "serviceAccountKey.json");

if (!fs.existsSync(serviceAccountPath)) {
  console.error(
    "Missing scripts/serviceAccountKey.json.\n" +
      "Download it from Firebase Console -> Project Settings -> Service Accounts -> Generate new private key."
  );
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node scripts/importQuestions.mjs <path-to-xlsx>");
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"))),
});
const db = admin.firestore();

function normalizeDifficulty(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s.startsWith("hard")) return "hard";
  if (s.startsWith("med")) return "medium";
  return "easy";
}

function stripUndefined(obj) {
  const clean = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) clean[k] = v;
  return clean;
}

function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const rows = [];
  const seenIds = new Set();
  let skipped = 0;
  let fileDuplicates = 0;

  for (const sheetName of wb.SheetNames) {
    const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
    for (const r of json) {
      const questionText = String(r["Question"] ?? "").trim();
      const expectedAnswer = String(r["Answer"] ?? "").trim();
      if (!questionText || !expectedAnswer) {
        skipped++;
        continue;
      }

      const tags = [];
      if (String(r["Scenario Based"] ?? "").trim().toLowerCase() === "yes") tags.push("scenario-based");
      const qaReviewer = String(r["QA"] ?? "").trim();
      if (qaReviewer) tags.push(`reviewed:${qaReviewer}`);
      if (String(r["Verified"] ?? "").trim().toLowerCase() === "yes") tags.push("verified");

      const rawId = String(r["Question No."] ?? "").trim();
      const dedupeKey = `${sheetName.trim()}::${rawId}`;
      if (rawId && seenIds.has(dedupeKey)) {
        fileDuplicates++;
        continue;
      }
      if (rawId) seenIds.add(dedupeKey);

      rows.push({
        module: sheetName.trim(),
        feature: String(r["Topic"] ?? sheetName).trim(),
        difficulty: normalizeDifficulty(r["Difficulty"]),
        tags,
        type: "descriptive",
        questionText,
        expectedAnswer,
        notes: String(r["Comments"] ?? "").trim() || undefined,
        sourceId: rawId ? dedupeKey : undefined,
      });
    }
  }
  return { rows, skipped, fileDuplicates };
}

async function loadExistingSourceIds(modules) {
  const existing = new Set();
  const unique = Array.from(new Set(modules));
  for (let i = 0; i < unique.length; i += 30) {
    const group = unique.slice(i, i + 30);
    const snap = await db.collection("questions").where("module", "in", group).get();
    snap.docs.forEach((d) => {
      const sourceId = d.data().sourceId;
      if (sourceId) existing.add(sourceId);
    });
  }
  return existing;
}

async function commitWithRetry(batch, maxRetries = 3) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      await batch.commit();
      return { ok: true };
    } catch (err) {
      attempt++;
      if (attempt > maxRetries) return { ok: false, error: err.message };
      await new Promise((res) => setTimeout(res, 500 * 2 ** (attempt - 1)));
    }
  }
  return { ok: false, error: "Retry loop exhausted" };
}

async function run() {
  const buffer = fs.readFileSync(filePath);
  const { rows, skipped, fileDuplicates } = parseWorkbook(buffer);
  console.log(`Parsed ${rows.length} valid questions (${skipped} skipped, ${fileDuplicates} duplicate Question No. within file).`);

  const existingSourceIds = await loadExistingSourceIds(rows.map((r) => r.module));
  const toUpload = rows.filter((r) => {
    if (r.sourceId && existingSourceIds.has(r.sourceId)) return false;
    if (r.sourceId) existingSourceIds.add(r.sourceId);
    return true;
  });
  const alreadyInFirestore = rows.length - toUpload.length;
  if (alreadyInFirestore > 0) {
    console.log(`Skipping ${alreadyInFirestore} rows already present in Firestore (matched by Question No.).`);
  }

  const BATCH_SIZE = 200;
  let imported = 0;
  let failed = 0;
  const failedBatches = [];

  for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
    const chunk = toUpload.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    chunk.forEach((row) => {
      const ref = db.collection("questions").doc();
      batch.set(ref, stripUndefined({
        ...row,
        createdBy: "system-import",
        version: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        stats: { timesAsked: 0, avgMarks: 0, correctPct: 0, incorrectPct: 0 },
      }));
    });

    const result = await commitWithRetry(batch);
    if (result.ok) {
      imported += chunk.length;
    } else {
      failed += chunk.length;
      failedBatches.push({ startIndex: i, count: chunk.length, error: result.error });
    }
    console.log(`  ${imported + failed}/${toUpload.length} processed (${imported} imported, ${failed} failed)...`);
  }

  console.log("\n--- Import summary ---");
  console.log(`Imported:   ${imported}`);
  console.log(`Failed:     ${failed}`);
  console.log(`Duplicates: ${fileDuplicates + alreadyInFirestore} (${fileDuplicates} in-file, ${alreadyInFirestore} already in Firestore)`);
  console.log(`Skipped:    ${skipped} (blank Question/Answer)`);
  if (failedBatches.length) {
    console.log("\nFailed batches (re-run this script to retry — succeeded rows won't be duplicated):");
    failedBatches.forEach((b) => console.log(`  Rows ${b.startIndex + 1}-${b.startIndex + b.count}: ${b.error}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
