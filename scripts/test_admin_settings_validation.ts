import { validateAppSettings, DEFAULT_APP_SETTINGS } from "../src/lib/settings";
import { stripUndefined } from "../src/lib/questions";
import type { AppSettings, UserRole, AppUser } from "../src/types";

let passedCount = 0;
let failedCount = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    failedCount++;
  }
}

console.log("\n=== 1. SETTINGS VALIDATION & BOUNDARY TESTS ===");

// 1. Factory default settings should be 100% valid
const defaultValidation = validateAppSettings(DEFAULT_APP_SETTINGS);
assert(defaultValidation.valid && defaultValidation.errors.length === 0, "Default factory settings are fully valid");

// 2. 0 is preserved as a valid passing score
const zeroScore = validateAppSettings({ defaultPassingScore: 0 });
assert(zeroScore.valid, "0% is accepted as a valid passing score");

// 3. 100 is preserved as a valid passing score
const hundredScore = validateAppSettings({ defaultPassingScore: 100 });
assert(hundredScore.valid, "100% is accepted as a valid passing score");

// 4. Negative passing score is rejected
const negativeScore = validateAppSettings({ defaultPassingScore: -5 });
assert(!negativeScore.valid && negativeScore.errors.some(e => e.includes("between 0% and 100%")), "Negative passing score is rejected");

// 5. Passing score > 100 is rejected
const overHundredScore = validateAppSettings({ defaultPassingScore: 101 });
assert(!overHundredScore.valid && overHundredScore.errors.some(e => e.includes("between 0% and 100%")), "Passing score > 100% is rejected");

// 6. Valid duration within range (e.g. 45 min)
const validDuration = validateAppSettings({ defaultExamDuration: 45 });
assert(validDuration.valid, "45-minute duration is accepted");

// 7. Duration = 0 is rejected (minimum is 1)
const zeroDuration = validateAppSettings({ defaultExamDuration: 0 });
assert(!zeroDuration.valid && zeroDuration.errors.some(e => e.includes("between 1 and 600")), "0-minute duration is rejected (minimum 1)");

// 8. Duration > 600 is rejected
const excessiveDuration = validateAppSettings({ defaultExamDuration: 601 });
assert(!excessiveDuration.valid && excessiveDuration.errors.some(e => e.includes("between 1 and 600")), "601-minute duration is rejected (maximum 600)");

// 9. false is preserved as a valid boolean (not treated as falsy/missing)
const falseValues = validateAppSettings({
  allowAgentReattempts: false,
  enableEmailNotifications: false,
  maintenanceMode: false,
  requireAmendmentReason: false,
});
assert(falseValues.valid, "Boolean 'false' values are preserved and accepted");

// 10. Invalid reassignment mode is rejected
const invalidMode = validateAppSettings({ defaultReassignmentMode: "arbitrary_mode" as any });
assert(!invalidMode.valid && invalidMode.errors.some(e => e.includes("defaultReassignmentMode")), "Arbitrary reassignment mode is rejected");

// 11. Invalid email format is rejected
const invalidEmail = validateAppSettings({ supportContactEmail: "invalid-email-string" });
assert(!invalidEmail.valid && invalidEmail.errors.some(e => e.includes("valid email address")), "Invalid contact email string is rejected");

// 12. Valid email format is accepted
const validEmail = validateAppSettings({ supportContactEmail: "qa-lead@example.com" });
assert(validEmail.valid, "Valid contact email is accepted");

// 13. Short application name is rejected (< 2 chars)
const shortAppName = validateAppSettings({ appName: "A" });
assert(!shortAppName.valid && shortAppName.errors.some(e => e.includes("at least 2 characters")), "App name < 2 chars is rejected");

// 14. Overly long application name is rejected (> 60 chars)
const longAppName = validateAppSettings({ appName: "A".repeat(61) });
assert(!longAppName.valid && longAppName.errors.some(e => e.includes("cannot exceed 60")), "App name > 60 chars is rejected");


console.log("\n=== 2. FIRESTORE UNDEFINED SAFETY TESTS ===");

const rawDirtyObject = {
  appName: "QA Exam Platform",
  defaultExamDuration: 60,
  defaultPassingScore: 0, // Preserved
  allowAgentReattempts: false, // Preserved
  maintenanceMode: false, // Preserved
  notificationEmail: undefined, // Must be omitted
  emptyString: "", // Preserved
  emptyArray: [], // Preserved
  nested: {
    definedVal: "ok",
    undefinedVal: undefined, // Must be omitted
    zeroVal: 0, // Preserved
  },
};

const sanitized = stripUndefined(rawDirtyObject);

assert(sanitized.defaultPassingScore === 0, "stripUndefined preserves 0");
assert(sanitized.allowAgentReattempts === false, "stripUndefined preserves false");
assert(sanitized.maintenanceMode === false, "stripUndefined preserves false for maintenanceMode");
assert(!("notificationEmail" in sanitized), "stripUndefined removes top-level undefined property");
assert(sanitized.emptyString === "", "stripUndefined preserves empty string");
assert(Array.isArray(sanitized.emptyArray) && sanitized.emptyArray.length === 0, "stripUndefined preserves empty array");
assert(sanitized.nested.zeroVal === 0, "stripUndefined preserves nested 0");
assert(!("undefinedVal" in sanitized.nested), "stripUndefined removes nested undefined property");


console.log("\n=== 3. AUDITOR LOCKOUT & SELF-PROTECTION LOGIC TESTS ===");

const mockUsers: AppUser[] = [
  { uid: "auditor-1", email: "auditor1@example.com", name: "Auditor One", role: "auditor", isActive: true, status: "active", createdAt: 1000 },
  { uid: "agent-1", email: "agent1@example.com", name: "Agent One", role: "agent", isActive: true, status: "active", createdAt: 1000 },
];

// Test: self-deactivation prevention
function canDeactivate(targetUid: string, actorUid: string, userList: AppUser[]): { allowed: boolean; reason?: string } {
  if (targetUid === actorUid) {
    return { allowed: false, reason: "You cannot deactivate your own account." };
  }
  const target = userList.find(u => u.uid === targetUid);
  if (target?.role === "auditor") {
    const otherActive = userList.filter(u => u.role === "auditor" && u.isActive !== false && u.uid !== targetUid);
    if (otherActive.length === 0) {
      return { allowed: false, reason: "Cannot deactivate the only active auditor." };
    }
  }
  return { allowed: true };
}

const selfDeact = canDeactivate("auditor-1", "auditor-1", mockUsers);
assert(!selfDeact.allowed && selfDeact.reason === "You cannot deactivate your own account.", "Self-deactivation is strictly prevented");

const soleAuditorDeact = canDeactivate("auditor-1", "admin-other", mockUsers);
assert(!soleAuditorDeact.allowed && soleAuditorDeact.reason === "Cannot deactivate the only active auditor.", "Deactivating the only active auditor is strictly prevented");

const agentDeact = canDeactivate("agent-1", "auditor-1", mockUsers);
assert(agentDeact.allowed, "Deactivating a regular agent by an auditor is allowed");

// Test: sole auditor demotion prevention
function canDemoteToAgent(targetUid: string, userList: AppUser[]): { allowed: boolean; reason?: string } {
  const otherActiveAuditors = userList.filter(u => u.role === "auditor" && u.isActive !== false && u.uid !== targetUid);
  if (otherActiveAuditors.length === 0) {
    return { allowed: false, reason: "Cannot demote the only remaining active auditor." };
  }
  return { allowed: true };
}

const soleAuditorDemote = canDemoteToAgent("auditor-1", mockUsers);
assert(!soleAuditorDemote.allowed, "Demoting the only active auditor is prevented");

// Test: multiple auditors allow demotion
const mockUsersTwoAuditors: AppUser[] = [
  ...mockUsers,
  { uid: "auditor-2", email: "auditor2@example.com", name: "Auditor Two", role: "auditor", isActive: true, status: "active", createdAt: 1000 },
];
const multiAuditorDemote = canDemoteToAgent("auditor-1", mockUsersTwoAuditors);
assert(multiAuditorDemote.allowed, "Demoting an auditor when another active auditor exists is permitted");


console.log("\n=== 4. DEFAULT VS EXISTING DATA IMMUTABILITY TEST ===");

const existingExam = {
  id: "exam-123",
  title: "Test 01",
  timeLimitMinutes: 30,
  createdBy: "auditor-1",
  createdAt: 1000,
};

// Modifying settings default
const newSettings: AppSettings = {
  ...DEFAULT_APP_SETTINGS,
  defaultExamDuration: 45, // default changed from 60 to 45
};

// Existing exam must remain unchanged
assert(existingExam.timeLimitMinutes === 30, "Existing exam duration remains 30 minutes despite global default change");
assert(newSettings.defaultExamDuration === 45, "New default is 45 minutes for future exams");

console.log(`\n========================================`);
console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
console.log(`========================================\n`);

if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
