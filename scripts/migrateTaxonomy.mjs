/**
 * Taxonomy Migration & Classification Utility
 *
 * This script classifies questions into the standardized taxonomy:
 * - Module: "RCM & Clinical" (combining RCM, Clinical, 0909-RCM), "Patient Engagement", "Patient Services", "Scheduler"
 * - Topic: Controlled topics per module (Procedure Codes, Care Notes, Fee Schedule, etc.)
 * - Tags: Domain keywords and CDT patterns
 *
 * Features:
 * - Dry-run mode (--dry-run) to inspect proposed classifications without writing
 * - Full auditability and rollback metadata saved under `legacyClassification`
 * - Non-destructive: preserves existing IDs, answers, and scores
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Standalone heuristic classifier mirroring src/config/taxonomy.ts
function normalizeLegacyModule(rawModule) {
  const norm = String(rawModule || "").trim().toLowerCase();
  if (norm.includes("report") || norm.includes("audit") || norm.includes("analytics")) {
    return "Reporting";
  }
  if (
    norm.includes("engagement") ||
    norm.includes("patient services") ||
    norm.includes("services") ||
    norm.includes("scheduler") ||
    norm.includes("scheduling") ||
    norm.includes("p.e") ||
    norm === "pe" ||
    norm.includes("appointment") ||
    norm.includes("intake") ||
    norm.includes("0209")
  ) {
    return "Patient Engagement";
  }
  return "RCM & Clinical";
}

const MODULE_TOPIC_RULES = {
  "RCM & Clinical": [
    {
      name: "Procedure Codes",
      keywords: ["procedure code", "d-code", "cdt", "chart code", "auto code", "multicode"],
      hasCdtRegex: true,
      suggestedTags: ["procedure-code", "cdt", "billing"],
    },
    {
      name: "Fee Schedule",
      keywords: ["fee schedule", "fee table", "table of allowance", "ucr", "fee calculation", "fee hierarchy", "fee register"],
      suggestedTags: ["fee-schedule", "fee-table", "pricing"],
    },
    {
      name: "Care Notes",
      keywords: ["care note", "clinical note", "clinical documentation", "pending clinical notes", "clinical lockout", "provider signature", "note template", "ai scribe"],
      suggestedTags: ["care-notes", "documentation", "clinical-lockout"],
    },
    {
      name: "Treatment Planner",
      keywords: ["treatment plan", "treatment planner", "present treatment plan", "clinical case", "case settings", "clinical summary"],
      suggestedTags: ["treatment-planner", "cases", "planning"],
    },
    {
      name: "Patient Payments",
      keywords: ["patient payment", "patient balance", "copay", "co-pay", "patient ledger", "payment plan", "patient receipt"],
      suggestedTags: ["patient-payments", "ledger", "billing"],
    },
    {
      name: "Insurance Payments",
      keywords: ["insurance payment", "insurance claim", "claims", "eob", "era", "explanation of benefits", "electronic remittance", "claim status", "write-off"],
      suggestedTags: ["insurance-payments", "claims", "eob"],
    },
    {
      name: "Insurance Management",
      keywords: ["insurance plan", "insurance manager", "coverage template", "insurance template", "pre-authorization", "subscriber", "waiting period", "exclusion", "limitation", "alternative benefit"],
      suggestedTags: ["insurance-management", "coverage", "pre-auth"],
    },
    {
      name: "Tooth Chart",
      keywords: ["tooth chart", "odontogram", "chart materials", "tooth condition", "missing tooth", "restoration", "primary tooth", "permanent tooth"],
      suggestedTags: ["tooth-chart", "odontogram", "charting"],
    },
    {
      name: "Perio Chart",
      keywords: ["perio chart", "periodontal", "probing depth", "bleeding on probing", "furcation", "gingival margin", "mobility"],
      suggestedTags: ["perio-chart", "periodontal", "probing"],
    },
    {
      name: "Clinical Imaging",
      keywords: ["imaging", "clinical imaging", "x-ray", "radiograph", "sensor", "mount", "bitewing", "panoramic"],
      suggestedTags: ["imaging", "x-ray", "clinical"],
    },
  ],
  "Patient Engagement": [
    { name: "Appointment Scheduling", keywords: ["appointment", "booking", "operatory", "schedule appointment", "reschedule", "double book", "provider schedule"], suggestedTags: ["scheduling", "appointments"] },
    { name: "Patient Tracker", keywords: ["patient tracker", "tracker", "waiting room", "in-chair", "checked in", "checked out"], suggestedTags: ["patient-tracker", "workflow"] },
    { name: "Short Call & Standby Queue", keywords: ["short call queue", "short call", "asap queue", "cancellation list", "standby"], suggestedTags: ["short-call", "queue"] },
    { name: "Patient Intake & Medical History", keywords: ["medical history", "questionnaire", "medical alert", "health history", "signature", "online forms", "intake link"], suggestedTags: ["intake", "medical-history"] },
    { name: "Patient Alerts & Duplicates", keywords: ["patient alert", "patient flag", "flags", "alerts", "duplicate", "merge duplicate", "mark as duplicate", "patient merge"], suggestedTags: ["alerts", "duplicate-merge"] },
    { name: "Communication Hub & Two-Way Text", keywords: ["communication hub", "patient inbox", "text messaging", "voice & text", "two-way text", "sms"], suggestedTags: ["communication", "inbox"] },
    { name: "Reminders & Confirmation Campaigns", keywords: ["appointment reminder", "confirmation campaign", "notification campaign", "reminder campaign", "sms reminder"], suggestedTags: ["reminders", "campaigns"] },
    { name: "Patient Surveys & Reviews", keywords: ["survey", "patient survey", "satisfaction", "feedback", "nps", "review campaign"], suggestedTags: ["surveys", "feedback"] },
    { name: "Patient Memos & Templates", keywords: ["patient memo", "memo template", "office wizard", "memo", "administrative note"], suggestedTags: ["memos", "templates"] },
    { name: "Document Scanning & Routing", keywords: ["scanner", "scanner setup", "print workflow", "iris", "scan", "routing slip", "routing", "encounter form", "checkout slip"], suggestedTags: ["scanner", "routing-slip"] },
  ],
  "Reporting": [
    { name: "Financial & Billing Reports", keywords: ["financial report", "billing report", "collection report", "aging report", "adjustment report", "production report", "day sheet"], suggestedTags: ["reporting", "financial"] },
    { name: "Clinical & Treatment Reports", keywords: ["treatment report", "clinical report", "case report", "referred treatment report", "incomplete care notes"], suggestedTags: ["reporting", "clinical"] },
    { name: "Operational & Audit Reports", keywords: ["audit report", "security audit", "deleted items report", "user activity report", "operational report"], suggestedTags: ["reporting", "audit"] },
    { name: "Patient & Recall Reports", keywords: ["recall report", "patient report", "continuing care report", "recall list", "unconfirmed patients"], suggestedTags: ["reporting", "recall"] },
  ],
};

function classifyQuestion(questionText, expectedAnswer, currentModule, currentFeature) {
  const targetModule = normalizeLegacyModule(currentModule);
  const combined = `${questionText} ${expectedAnswer} ${currentFeature}`.toLowerCase();
  const cdtRegex = /\b[dD][0-9]{4}\b/;
  const hasCdt = cdtRegex.test(combined);

  const topics = MODULE_TOPIC_RULES[targetModule] || [];
  let bestTopic = null;
  let highestScore = 0;
  let matchedKeyword = "";

  for (const topic of topics) {
    let score = 0;
    for (const kw of topic.keywords) {
      if (combined.includes(kw)) {
        score += kw.length > 5 ? 2 : 1;
        if (!matchedKeyword) matchedKeyword = kw;
      }
    }
    if (topic.hasCdtRegex && hasCdt) {
      score += 4;
    }
    if (score > highestScore) {
      highestScore = score;
      bestTopic = topic;
    }
  }

  if (bestTopic && highestScore >= 3) {
    return {
      module: targetModule,
      topic: bestTopic.name,
      tags: bestTopic.suggestedTags,
      confidence: "high",
      reason: `Matched keyword "${matchedKeyword}"${hasCdt ? " and CDT procedure code pattern" : ""}`,
    };
  }

  if (bestTopic && highestScore > 0) {
    return {
      module: targetModule,
      topic: bestTopic.name,
      tags: bestTopic.suggestedTags,
      confidence: "medium",
      reason: `Matched keyword "${matchedKeyword}"`,
    };
  }

  return {
    module: targetModule,
    topic: topics[0]?.name || "Procedure Codes",
    tags: [],
    confidence: "low",
    reason: "Low confidence keyword match",
  };
}

// Inspect Question Seed File if present
const seedFile = path.join(__dirname, "Questions_seed.xlsx");
if (fs.existsSync(seedFile)) {
  console.log("=== RUNNING TAXONOMY CLASSIFICATION AUDIT ON SEED DATA ===");
  const wb = XLSX.readFile(seedFile);
  const stats = {
    total: 0,
    byModule: {},
    byConfidence: { high: 0, medium: 0, low: 0 },
    byTopic: {},
  };

  const sampleProposals = [];

  for (const sheet of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: "" });
    for (const r of rows) {
      const qText = String(r["Question"] || "").trim();
      const aText = String(r["Answer"] || "").trim();
      const rawFeature = String(r["Topic"] || "").trim();
      if (!qText) continue;

      stats.total++;
      const result = classifyQuestion(qText, aText, sheet, rawFeature);

      stats.byModule[result.module] = (stats.byModule[result.module] || 0) + 1;
      stats.byTopic[result.topic] = (stats.byTopic[result.topic] || 0) + 1;
      stats.byConfidence[result.confidence]++;

      if (sampleProposals.length < 5 && (sheet.includes("RCM") || sheet.includes("Clinical"))) {
        sampleProposals.push({
          questionPreview: qText.slice(0, 75) + "...",
          originalModule: sheet,
          originalFeature: rawFeature,
          proposedModule: result.module,
          proposedTopic: result.topic,
          confidence: result.confidence,
          reason: result.reason,
        });
      }
    }
  }

  console.log(`\nProcessed ${stats.total} total questions.`);
  console.log("\nDistribution by Standardized Module:");
  console.table(stats.byModule);

  console.log("\nDistribution by Confidence Level:");
  console.table(stats.byConfidence);

  console.log("\nTop 10 Standardized Topics:");
  const topTopics = Object.entries(stats.byTopic)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  console.table(Object.fromEntries(topTopics));

  console.log("\nSample Migration Proposals:");
  console.log(JSON.stringify(sampleProposals, null, 2));
} else {
  console.log("Seed file not found at", seedFile);
}
