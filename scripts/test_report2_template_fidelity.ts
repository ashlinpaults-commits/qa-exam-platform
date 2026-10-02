import * as XLSX from "xlsx";
import {
  buildReport2Dataset,
  exportReport2ToExcel,
} from "../src/lib/reportGeneratorV2";
import type { AppUser, Exam, ExamAttempt, Question } from "../src/types";

console.log("==================================================");
console.log("RUNNING REPORT 2.0 TEMPLATE FIDELITY & DATA TESTS");
console.log("==================================================");

// 1. Read the golden template
const templatePath = "C:/Users/ashlinpaul/Desktop/Audios/Team_Agent_Performance_Reports.xlsx";
const goldenWb = XLSX.readFile(templatePath);

const expectedSheets = [
  "Agent Summary",
  "Exam Performance",
  "Frequently Missed Questions",
  "Attempt History",
  "Overall",
];

// Verify Golden Workbook Sheet Names
console.log("[TEST 1] Verifying Golden Template Sheet Names...");
if (JSON.stringify(goldenWb.SheetNames) !== JSON.stringify(expectedSheets)) {
  console.error("FAIL: Golden sheet names mismatch:", goldenWb.SheetNames);
  process.exit(1);
}
console.log("PASS: Expected sheets verified:", goldenWb.SheetNames);

// Verify Golden Headers for each sheet
const goldenHeaders: Record<string, string[]> = {};
goldenWb.SheetNames.forEach((sheetName) => {
  const ws = goldenWb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][];
  if (data.length > 0) {
    goldenHeaders[sheetName] = data[0];
  } else {
    goldenHeaders[sheetName] = [];
  }
});

console.log("\n[TEST 2] Verifying Golden Template Column Structure:");
expectedSheets.forEach((s) => {
  console.log(`- Sheet "${s}": ${goldenHeaders[s].length} columns`);
});

// 2. Create mock realistic test data representing:
// - Multiple agents (including one with 0 attempts, one with reattempts, one with amended scores)
// - Multiple exams (normal and until_perfect)
// - Questions with rich taxonomy and descriptions
// - Reattempts with cumulative progression (Attempt 1: 50%, Attempt 2: 80%)
// - Cancelled/revoked assignments to ensure they are NOT counted
// - Zero scores to ensure 0 is not converted to empty/blank
const mockUsers: AppUser[] = [
  {
    uid: "agent_1",
    name: "Adithya Kiran",
    email: "adithyakiran@carestack.com",
    role: "agent",
    createdAt: Date.now() - 1000000,
  },
  {
    uid: "agent_2",
    name: "Dishan R",
    email: "dishanr@carestack.com",
    role: "agent",
    createdAt: Date.now() - 1000000,
  },
  {
    uid: "agent_3_zero",
    name: "Zero Attempts Agent",
    email: "zero@carestack.com",
    role: "agent",
    createdAt: Date.now() - 1000000,
  },
];

const mockQuestions: Question[] = [
  {
    id: "q1",
    questionText: "Appointment scheduling: How can upcoming appointments be grouped under a single chip?",
    expectedAnswer: "Group by family account or linked patients.",
    type: "descriptive",
    module: "Patient Engagement",
    feature: "Patient Tracker",
    topic: "Patient Tracker",
    difficulty: "medium",
    tags: ["scheduling"],
    notes: "",
    version: 1,
    createdBy: "auditor",
    createdAt: 1000,
    updatedAt: 1000,
  },
  {
    id: "q2",
    questionText: "Explain how recurring recalls are set up in the scheduler.",
    expectedAnswer: "Navigate to patient overview and select recall interval.",
    type: "descriptive",
    module: "Patient Engagement",
    feature: "Production Calendar",
    topic: "Production Calendar",
    difficulty: "hard",
    tags: ["recall"],
    notes: "",
    version: 1,
    createdBy: "auditor",
    createdAt: 1000,
    updatedAt: 1000,
  },
  {
    id: "q3_legacy_topic",
    questionText: "How do you generate an insurance claim batch in RCM?",
    expectedAnswer: "Select billing tab, batch claims, and export 837.",
    type: "descriptive",
    module: "General",
    feature: "0109 - RCM", // Legacy topic to test taxonomy cleaning
    topic: "Sheet1",
    difficulty: "easy",
    tags: ["claims"],
    notes: "",
    version: 1,
    createdBy: "auditor",
    createdAt: 1000,
    updatedAt: 1000,
  },
];

const mockExams: Exam[] = [
  {
    id: "exam_1",
    name: "PS1126 | Patient Engagement | Test 01",
    description: "",
    mode: "normal",
    questions: [
      { questionId: "q1", order: 1 },
      { questionId: "q2", order: 2 },
    ],
    assignedAgentIds: ["agent_1", "agent_2", "agent_3_zero"],
    status: "published",
    createdAt: Date.now() - 500000,
    updatedAt: Date.now() - 500000,
    createdBy: "auditor",
  },
  {
    id: "exam_2_perfect",
    name: "PS1126 | Patient Engagement | Perfect 10 Mastery",
    description: "",
    mode: "until_perfect",
    questions: [
      { questionId: "q1", order: 1 },
      { questionId: "q3_legacy_topic", order: 2 },
    ],
    assignedAgentIds: ["agent_1"],
    status: "published",
    createdAt: Date.now() - 400000,
    updatedAt: Date.now() - 400000,
    createdBy: "auditor",
  },
];

const mockAttempts: ExamAttempt[] = [
  // Agent 1 on Exam 1: Attempt 1 (scored 10/20 = 50%)
  {
    id: "att_1",
    examId: "exam_1",
    agentId: "agent_1",
    attemptNumber: 1,
    status: "reviewed",
    startedAt: Date.now() - 300000,
    submittedAt: Date.now() - 290000,
    timeTakenSeconds: 3600,
    totalMarks: 10,
    maxTotalMarks: 20,
    answers: [
      {
        questionId: "q1",
        agentAnswer: "Group by single chip",
        marks: 10, // 100% correct
        maxMarks: 10,
      },
      {
        questionId: "q2",
        agentAnswer: "I do not know",
        marks: 0, // 0% incorrect (Zero test)
        maxMarks: 10,
        knowledgeGapCategory: "Product Knowledge",
      },
    ],
  },
  // Agent 1 on Exam 1: Reattempt (Attempt 2: scored 10/10 on q2, so Master Score = 20/20 = 100%)
  {
    id: "att_2",
    examId: "exam_1",
    agentId: "agent_1",
    attemptNumber: 2,
    isReattempt: true,
    status: "reviewed",
    startedAt: Date.now() - 200000,
    submittedAt: Date.now() - 190000,
    timeTakenSeconds: 1800,
    totalMarks: 10,
    maxTotalMarks: 10,
    answers: [
      {
        questionId: "q2",
        agentAnswer: "Navigate to patient overview and select recall interval correctly",
        marks: 10, // Mastered!
        maxMarks: 10,
      },
    ],
  },
  // Agent 2 on Exam 1: Attempt 1 (submitted, pending review)
  {
    id: "att_3_pending",
    examId: "exam_1",
    agentId: "agent_2",
    attemptNumber: 1,
    status: "submitted",
    startedAt: Date.now() - 100000,
    submittedAt: Date.now() - 95000,
    timeTakenSeconds: 2400,
    answers: [
      {
        questionId: "q1",
        agentAnswer: "Some answer",
        maxMarks: 10,
      },
      {
        questionId: "q2",
        agentAnswer: "Another answer",
        maxMarks: 10,
      },
    ],
  },
  // Revoked attempt - MUST NOT BE COUNTED
  {
    id: "att_revoked",
    examId: "exam_1",
    agentId: "agent_2",
    attemptNumber: 2,
    status: "revoked",
    startedAt: Date.now() - 50000,
    answers: [],
  },
];

console.log("\n[TEST 3] Building Report 2.0 Dataset...");
const dataset = buildReport2Dataset({
  agents: mockUsers,
  exams: mockExams,
  attempts: mockAttempts,
  questions: mockQuestions,
});

console.log("Agent summaries count:", dataset.agentSummaries.length);
console.log("Exam performances count:", dataset.examPerformances.length);
console.log("Missed questions count:", dataset.frequentlyMissedQuestions.length);
console.log("Attempt history count:", dataset.attemptHistories.length);

// 3. Export to test file and inspect output
const outputPath = "C:/Users/ashlinpaul/Desktop/Apps Backed Up/qa-exam-platform - Copy/scripts/test_output_report2.xlsx";
exportReport2ToExcel(dataset, outputPath);

const generatedWb = XLSX.readFile(outputPath);

console.log("\n[TEST 4] Validating Generated Workbook Sheets...");
if (JSON.stringify(generatedWb.SheetNames) !== JSON.stringify(expectedSheets)) {
  console.error("FAIL: Generated sheet names mismatch!", generatedWb.SheetNames);
  process.exit(1);
}
console.log("PASS: Sheet names match exactly 100%:", generatedWb.SheetNames);

console.log("\n[TEST 5] Validating Exact Column Headers & Order...");
expectedSheets.forEach((sheetName) => {
  const ws = generatedWb.Sheets[sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][];
  const actualCols = data.length > 0 ? data[0] : [];
  const expectedCols = goldenHeaders[sheetName];

  console.log(`Checking Sheet: "${sheetName}"...`);
  if (JSON.stringify(actualCols) !== JSON.stringify(expectedCols)) {
    console.error(`FAIL: Column mismatch in sheet "${sheetName}":`);
    console.error("Expected:", expectedCols);
    console.error("Actual:  ", actualCols);
    process.exit(1);
  }
  console.log(`PASS: Sheet "${sheetName}" matches golden columns exactly! (${actualCols.length} cols)`);
});

// 4. Verify Content Correctness
console.log("\n[TEST 6] Validating Data Values & Calculations...");

// Check Agent 1 summary
const agent1Summary = dataset.agentSummaries.find((s) => s["Agent Name"] === "Adithya Kiran");
if (!agent1Summary) {
  console.error("FAIL: Agent 1 summary not found");
  process.exit(1);
}
console.log("Agent 1 Summary:", JSON.stringify(agent1Summary, null, 2));

// Adithya Kiran has Exam 1: Attempt 1 (10/20) + Attempt 2 (10/10) -> Master Score = 20 / 20 (100%)
if (agent1Summary["Overall Score (%)"] !== "100%") {
  console.error("FAIL: Overall score should be 100%, got:", agent1Summary["Overall Score (%)"]);
  process.exit(1);
}
console.log("PASS: Master progress correctly reflected as 100% in Overall Score");

// Check Agent 3 (Zero attempts agent)
const zeroAgentSummary = dataset.agentSummaries.find((s) => s["Agent Name"] === "Zero Attempts Agent");
if (!zeroAgentSummary) {
  console.error("FAIL: Zero agent summary not found");
  process.exit(1);
}
if (zeroAgentSummary["Total Attempts"] !== 0 || zeroAgentSummary["Tests Attempted"] !== 0) {
  console.error("FAIL: Zero agent should have 0 attempts, got:", zeroAgentSummary);
  process.exit(1);
}
console.log("PASS: Zero attempts agent correctly preserved with 0 values without crash");

// Check Frequently Missed Questions: actual question text and clean taxonomy
const qMissed = dataset.frequentlyMissedQuestions.find((q) => q.Question.includes("recurring recalls"));
if (!qMissed) {
  console.error("FAIL: Frequently missed question not found");
  process.exit(1);
}
if (!qMissed.Question || qMissed.Question === "q2") {
  console.error("FAIL: Missed question must contain actual question text, got:", qMissed.Question);
  process.exit(1);
}
if (qMissed.Topic === "Sheet1" || qMissed.Topic.includes("0109")) {
  console.error("FAIL: Legacy topic name was not cleaned, got:", qMissed.Topic);
  process.exit(1);
}
console.log("PASS: Actual question text and clean topic classification verified:", {
  Question: qMissed.Question,
  Module: qMissed.Module,
  Topic: qMissed.Topic,
  Progression: qMissed.Progression,
  EventuallyMastered: qMissed["Eventually Mastered"],
});

// Check Attempt History: Cumulative progression
const att2History = dataset.attemptHistories.find((h) => h["Attempt Number"] === 2 && h["Agent Name"] === "Adithya Kiran");
if (!att2History) {
  console.error("FAIL: Attempt 2 history not found");
  process.exit(1);
}
if (att2History["Master Progress"] !== "20 / 20" || att2History["Progress Gain"] !== "+10") {
  console.error("FAIL: Attempt 2 progress gain or master progress mismatch:", att2History);
  process.exit(1);
}
console.log("PASS: Attempt progression correctly shows cumulative master progress:", att2History);

// Check Revoked attempt exclusion
const revokedInHistory = dataset.attemptHistories.some((h) => h.Status === "revoked");
if (revokedInHistory) {
  console.error("FAIL: Revoked attempt should not be in active attempt history");
  process.exit(1);
}
console.log("PASS: Revoked attempts safely excluded from active history");

console.log("\n==================================================");
console.log("ALL REPORT 2.0 TEMPLATE & FIDELITY TESTS PASSED 100%!");
console.log("==================================================");
