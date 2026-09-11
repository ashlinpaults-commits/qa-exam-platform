/**
 * Standardized QA Exam Platform Business Taxonomy
 *
 * Core Hierarchy:
 * Batch (cohort) -> Module (business area) -> Topic (workflow/skill) -> Question -> Tags
 */

export const CONTROLLED_MODULES = [
  "RCM & Clinical",
  "Patient Engagement",
  "Reporting",
] as const;

export type ControlledModule = (typeof CONTROLLED_MODULES)[number];

export interface TopicDefinition {
  name: string;
  description: string;
  keywords: string[];
  suggestedTags: string[];
}

export const MODULE_TOPICS: Record<ControlledModule, TopicDefinition[]> = {
  "RCM & Clinical": [
    {
      name: "Procedure Codes",
      description: "CDT codes, charting procedures, code configurations, multi-code setup, and auto-codes.",
      keywords: ["procedure code", "d-code", "cdt", "d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "chart code", "auto code", "multicode"],
      suggestedTags: ["procedure-code", "cdt", "charting", "billing"],
    },
    {
      name: "Fee Schedule",
      description: "Fee tables, fee schedule assignment, allowable fees, UCR, and fee calculation hierarchies.",
      keywords: ["fee schedule", "fee table", "table of allowance", "ucr", "fee calculation", "fee hierarchy", "fee register", "fee import"],
      suggestedTags: ["fee-schedule", "fee-table", "billing", "pricing"],
    },
    {
      name: "Care Notes",
      description: "Clinical documentation, care note templates, provider signatures, pending notes, and clinical lockout.",
      keywords: ["care note", "clinical note", "clinical documentation", "pending clinical notes", "clinical lockout", "provider signature", "note template", "ai scribe"],
      suggestedTags: ["care-notes", "documentation", "clinical-lockout", "templates"],
    },
    {
      name: "Treatment Planner",
      description: "Treatment plans, cases, case presentation, pre-authorization linking, and planned procedures.",
      keywords: ["treatment plan", "treatment planner", "present treatment plan", "clinical case", "case settings", "clinical summary", "treatment case"],
      suggestedTags: ["treatment-planner", "cases", "planning", "presentation"],
    },
    {
      name: "Patient Payments",
      description: "Patient payments, co-pays, patient ledger, patient balance, payment plans, and receipts.",
      keywords: ["patient payment", "patient balance", "copay", "co-pay", "patient ledger", "payment plan", "patient receipt", "guarantor payment"],
      suggestedTags: ["patient-payments", "ledger", "copay", "billing"],
    },
    {
      name: "Insurance Payments",
      description: "Insurance payments, EOB posting, ERA, claims processing, write-offs, and adjustments.",
      keywords: ["insurance payment", "insurance claim", "claims", "eob", "era", "explanation of benefits", "electronic remittance", "claim status", "write-off", "insurance adjustment"],
      suggestedTags: ["insurance-payments", "claims", "eob", "era", "adjustments"],
    },
    {
      name: "Insurance Management",
      description: "Insurance plans, coverage templates, subscribers, pre-authorization, eligibility, and exclusions.",
      keywords: ["insurance plan", "insurance manager", "coverage template", "insurance template", "pre-authorization", "subscriber", "waiting period", "exclusion", "limitation", "alternative benefit", "draft insurance"],
      suggestedTags: ["insurance-management", "coverage", "pre-auth", "subscribers"],
    },
    {
      name: "Tooth Chart",
      description: "Odontogram, tooth chart conditions, missing teeth, restorations, and dental charting workflows.",
      keywords: ["tooth chart", "odontogram", "chart materials", "tooth condition", "missing tooth", "restoration", "primary tooth", "permanent tooth"],
      suggestedTags: ["tooth-chart", "odontogram", "charting", "clinical"],
    },
    {
      name: "Perio Chart",
      description: "Periodontal probing depths, bleeding points, recession, furcation, and perio exam workflows.",
      keywords: ["perio chart", "periodontal", "probing depth", "bleeding on probing", "furcation", "gingival margin", "mobility", "perio exam"],
      suggestedTags: ["perio-chart", "periodontal", "probing", "clinical"],
    },
    {
      name: "Clinical Imaging",
      description: "Dental radiographs, X-ray mounts, sensor setup, imaging bridge, and image linking.",
      keywords: ["imaging", "clinical imaging", "x-ray", "radiograph", "sensor", "mount", "bitewing", "panoramic"],
      suggestedTags: ["imaging", "x-ray", "clinical", "radiology"],
    },
  ],
  "Patient Engagement": [
    {
      name: "Scheduler",
      description: "Appointment booking, scheduling conflicts, operatory setup, chair allocations, and schedule management.",
      keywords: ["appointment", "booking", "operatory", "schedule appointment", "reschedule", "double book", "scheduling", "chair allocation"],
      suggestedTags: ["scheduler", "appointments", "booking"],
    },
    {
      name: "Patient Services",
      description: "Patient intake, medical history questionnaires, duplicate patient management, patient alerts, flags, and memos.",
      keywords: ["patient services", "medical history", "questionnaire", "medical alert", "patient alert", "duplicate patient", "merge duplicate", "patient memo", "memo template", "scanner setup", "iris"],
      suggestedTags: ["patient-services", "intake", "medical-history", "alerts"],
    },
    {
      name: "Appointment Reminders",
      description: "Automated reminder campaigns, confirmations, notifications, and cadence rules.",
      keywords: ["appointment reminder", "confirmation campaign", "notification campaign", "reminder campaign", "sms reminder", "reminders"],
      suggestedTags: ["reminders", "campaigns", "confirmations"],
    },
    {
      name: "Communication Hub",
      description: "Two-way text messaging, patient inbox, voice & text configuration, and messaging threads.",
      keywords: ["communication hub", "patient inbox", "text messaging", "voice & text", "two-way text", "sms", "messaging"],
      suggestedTags: ["communication", "inbox", "sms", "messaging"],
    },
    {
      name: "Campaign Management",
      description: "Marketing campaigns, review campaigns, payment plan reminders, and campaign performance.",
      keywords: ["campaign", "review campaign", "payment plan reminder campaign", "campaign activity", "marketing"],
      suggestedTags: ["campaigns", "marketing", "reviews"],
    },
    {
      name: "Patient Surveys",
      description: "Post-visit feedback surveys, satisfaction ratings, and survey analytics.",
      keywords: ["survey", "patient survey", "satisfaction", "feedback", "nps"],
      suggestedTags: ["surveys", "feedback", "satisfaction"],
    },
    {
      name: "Patient Tracker",
      description: "Patient tracking bar, waiting room status, in-chair tracking, and checkout transitions.",
      keywords: ["patient tracker", "tracker", "waiting room", "in-chair", "checked in", "checked out"],
      suggestedTags: ["patient-tracker", "workflow", "front-desk"],
    },
    {
      name: "Routing Slip",
      description: "Routing slip generation, encounter forms, checkout forms, and day slip management.",
      keywords: ["routing slip", "routing", "encounter form", "checkout slip"],
      suggestedTags: ["routing-slip", "checkout", "front-desk"],
    },
    {
      name: "Short Call Queue",
      description: "ASAP lists, cancellation fill queues, standby patients, and short call queues.",
      keywords: ["short call queue", "short call", "asap queue", "cancellation list", "standby"],
      suggestedTags: ["short-call", "queue", "cancellations"],
    },
  ],
  "Reporting": [
    {
      name: "Financial & Billing Reports",
      description: "Day sheets, production and collections, accounts receivable (AR aging), adjustment reports, and deposit registers.",
      keywords: ["financial report", "billing report", "day sheet", "production report", "collection report", "accounts receivable", "ar aging", "adjustment report", "deposit slip", "billing summary"],
      suggestedTags: ["financial-reports", "billing", "production", "ar-aging"],
    },
    {
      name: "Clinical & Treatment Reports",
      description: "Treatment tracker, case acceptance reports, unscheduled treatment, provider productivity, and clinical activity summaries.",
      keywords: ["clinical report", "treatment report", "treatment tracker", "case acceptance", "unscheduled treatment", "provider productivity", "clinical summary report", "perio report"],
      suggestedTags: ["clinical-reports", "treatment-tracker", "productivity"],
    },
    {
      name: "Operational & Audit Reports",
      description: "Audit trails, deleted transactions, daily operational logs, fee schedule comparison, and security audits.",
      keywords: ["operational report", "audit report", "audit trail", "deleted transaction", "activity log", "daily log", "security log", "compliance report"],
      suggestedTags: ["audit-reports", "compliance", "activity-log"],
    },
    {
      name: "Patient & Recall Reports",
      description: "Recall and recare lists, continuing care, inactive patient reports, and new patient acquisition analytics.",
      keywords: ["patient report", "recall report", "recare", "continuing care", "inactive patient", "new patient report", "patient list", "retention"],
      suggestedTags: ["patient-reports", "recall", "retention"],
    },
  ],
};

/**
 * Maps legacy module names to the canonical controlled module name.
 */
export function normalizeLegacyModule(rawModule: string): ControlledModule {
  const norm = (rawModule || "").trim().toLowerCase();

  // RCM + Clinical = ONE MODULE (including legacy sheet tab names 0109, 0209, 0909)
  if (
    norm.includes("rcm") ||
    norm.includes("0909") ||
    norm.includes("0109") ||
    norm.includes("0209") ||
    norm.includes("clinical") ||
    norm.includes("revenue cycle")
  ) {
    return "RCM & Clinical";
  }

  // Reporting / Analytics
  if (
    norm.includes("reporting") ||
    norm.includes("report") ||
    norm.includes("analytics")
  ) {
    return "Reporting";
  }

  // Patient Engagement (including Scheduler, Patient Services, Front Desk, Campaigns)
  if (
    norm.includes("engagement") ||
    norm.includes("patient services") ||
    norm.includes("services") ||
    norm.includes("scheduler") ||
    norm.includes("scheduling") ||
    norm.includes("p.e") ||
    norm === "pe"
  ) {
    return "Patient Engagement";
  }

  // Default fallback for ambiguous or unclassified modules
  return "RCM & Clinical";
}

/**
 * Fast keyword + semantic heuristic to classify question text into a controlled Topic.
 */
export function classifyQuestionTaxonomy(
  questionText: string,
  expectedAnswer = "",
  currentModule = "",
  currentFeature = ""
): {
  suggestedModule: ControlledModule;
  suggestedTopic: string;
  suggestedTags: string[];
  confidence: "high" | "medium" | "low";
  reason: string;
} {
  const targetModule = normalizeLegacyModule(currentModule);
  const combinedText = `${questionText} ${expectedAnswer} ${currentFeature}`.toLowerCase();

  // Inspect CDT procedure code patterns (e.g. D0120, D2110, D4341, D7140)
  const cdtRegex = /\b[dD][0-9]{4}\b/;
  const hasCdtCode = cdtRegex.test(combinedText);

  // Check topics within the target module first
  const topicsInModule = MODULE_TOPICS[targetModule] || [];

  let bestTopic: TopicDefinition | null = null;
  let highestScore = 0;
  let matchedKeyword = "";

  for (const topic of topicsInModule) {
    let score = 0;
    for (const kw of topic.keywords) {
      if (combinedText.includes(kw)) {
        score += kw.length > 5 ? 2 : 1;
        if (!matchedKeyword) matchedKeyword = kw;
      }
    }
    // Boost procedure codes if a CDT code is detected
    if (topic.name === "Procedure Codes" && hasCdtCode) {
      score += 4;
    }

    if (score > highestScore) {
      highestScore = score;
      bestTopic = topic;
    }
  }

  // If no good match within module, search across all modules
  if (!bestTopic || highestScore === 0) {
    for (const [mod, topics] of Object.entries(MODULE_TOPICS)) {
      for (const topic of topics) {
        for (const kw of topic.keywords) {
          if (combinedText.includes(kw)) {
            const score = kw.length > 5 ? 2 : 1;
            if (score > highestScore) {
              highestScore = score;
              bestTopic = topic;
              matchedKeyword = kw;
            }
          }
        }
      }
    }
  }

  if (bestTopic && highestScore >= 3) {
    return {
      suggestedModule: targetModule,
      suggestedTopic: bestTopic.name,
      suggestedTags: bestTopic.suggestedTags,
      confidence: "high",
      reason: `Matched specific business keywords: "${matchedKeyword}"${hasCdtCode ? " and CDT procedure code pattern" : ""}.`,
    };
  }

  if (bestTopic && highestScore > 0) {
    return {
      suggestedModule: targetModule,
      suggestedTopic: bestTopic.name,
      suggestedTags: bestTopic.suggestedTags,
      confidence: "medium",
      reason: `Matched domain keyword "${matchedKeyword}". Auditor confirmation recommended.`,
    };
  }

  // Fallback to primary module topic if unclassified
  const fallbackTopic = topicsInModule[0]?.name || "Procedure Codes";
  return {
    suggestedModule: targetModule,
    suggestedTopic: fallbackTopic,
    suggestedTags: [],
    confidence: "low",
    reason: "Insufficient keyword matches. Manual auditor classification required.",
  };
}
