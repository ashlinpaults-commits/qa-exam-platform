import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type {
  AgentPerformanceReportData,
  AgentExamPerformance,
  AgentAttemptRecord,
  AgentMissedQuestion,
} from "./agentReports";
import { formatTimeTaken } from "./agentReports";

/* =========================================================
   COLOR PALETTE DEFINITIONS (QA EXAM PLATFORM RED BRAND)
   ========================================================= */

const COLORS = {
  brandRed: [185, 28, 50] as [number, number, number], // #b91c32
  brandDark: [126, 20, 35] as [number, number, number], // #7e1423
  brandTint: [253, 242, 244] as [number, number, number], // #fdf2f4
  brandBorder: [245, 173, 181] as [number, number, number], // #f5adb5
  charcoal: [15, 23, 42] as [number, number, number], // #0f172a
  textPrimary: [30, 41, 59] as [number, number, number], // #1e293b
  textMuted: [100, 116, 139] as [number, number, number], // #64748b
  textLight: [148, 163, 184] as [number, number, number], // #94a3b8
  bgLight: [248, 250, 252] as [number, number, number], // #f8fafc
  border: [226, 232, 240] as [number, number, number], // #e2e8f0
  white: [255, 255, 255] as [number, number, number],
  emerald: [5, 150, 105] as [number, number, number], // #059669
  amber: [217, 119, 6] as [number, number, number], // #d97706
  rose: [225, 29, 72] as [number, number, number], // #e11d48
};

const MARGIN_LEFT = 15;
const MARGIN_RIGHT = 15;
const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT; // 180mm
const BOTTOM_LIMIT = 275; // Leave room for footer

/* =========================================================
   HELPER UTILITIES
   ========================================================= */

function stripFormatting(text?: string): string {
  if (!text) return "";
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/\[\/?(?:highlight|color|size|font)[^\]]*\]/gi, "")
    .replace(/[*_~^`]+/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function formatDate(timestamp?: number | null): string {
  if (!timestamp || timestamp <= 0) return "—";
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(timestamp?: number | null): string {
  if (!timestamp || timestamp <= 0) return "—";
  return new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/* =========================================================
   EXPORT FUNCTION: AGENT REPORTS TO PDF
   ========================================================= */

export function exportAgentReportsToPdf(
  reports: AgentPerformanceReportData[],
  filename = "agent_performance_report.pdf"
) {
  if (!reports || reports.length === 0) return;

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const isMultiAgent = reports.length > 1;

  // Render multi-agent summary table if more than one agent selected
  if (isMultiAgent) {
    renderMultiAgentIndex(doc, reports);
  }

  // Render complete report for each individual agent
  reports.forEach((report, index) => {
    if (isMultiAgent || index > 0) {
      doc.addPage();
    }
    renderSingleAgentReport(doc, report);
  });

  // Apply running headers and footers across all pages
  applyHeadersAndFooters(doc, reports);

  // Save the generated PDF document directly to user download
  doc.save(filename);
}

/* =========================================================
   MULTI-AGENT INDEX (COVER / COMPARISON SUMMARY)
   ========================================================= */

function renderMultiAgentIndex(
  doc: jsPDF,
  reports: AgentPerformanceReportData[]
) {
  let y = 25;

  // Title Banner
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.brandRed);
  doc.text("QA EXAM PLATFORM", MARGIN_LEFT, y);

  y += 6;
  doc.setFontSize(20);
  doc.setTextColor(...COLORS.charcoal);
  doc.text("Agent Performance Report — Team Overview", MARGIN_LEFT, y);

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(
    `Executive summary comparison of ${reports.length} selected agents · Generated ${formatDateTime(
      reports[0]?.generatedAt || Date.now()
    )}`,
    MARGIN_LEFT,
    y
  );

  y += 4;
  doc.setDrawColor(...COLORS.brandRed);
  doc.setLineWidth(0.75);
  doc.line(MARGIN_LEFT, y, MARGIN_LEFT + CONTENT_WIDTH, y);

  y += 8;

  // Comparison Summary Table
  const tableData = reports.map((r) => [
    r.agent.name || "Agent",
    r.agent.email || "—",
    r.summary.overallScore !== null ? `${r.summary.overallScore}%` : "No data",
    r.summary.competencyScore !== null ? `${r.summary.competencyScore}%` : "N/A",
    `${r.summary.testsCompleted} / ${r.summary.totalTestsAssigned}`,
    String(r.summary.totalAttempts),
    `${r.summary.completionRate}%`,
    r.trend === "improving"
      ? `Improving (+${r.trendVelocity || 0}%)`
      : r.trend === "declining"
      ? `Declining (${r.trendVelocity || 0}%)`
      : r.trend === "stable"
      ? "Stable"
      : "Need 2+ reviews",
  ]);

  autoTable(doc, {
    startY: y,
    head: [
      [
        "Agent Name",
        "Email",
        "Overall",
        "Competency",
        "Tests (Comp/Assigned)",
        "Attempts",
        "Completion",
        "Learning Trend",
      ],
    ],
    body: tableData,
    theme: "striped",
    headStyles: {
      fillColor: COLORS.brandRed,
      textColor: COLORS.white,
      fontStyle: "bold",
      fontSize: 8.5,
      halign: "left",
      cellPadding: 3,
    },
    styles: {
      fontSize: 8,
      textColor: COLORS.textPrimary,
      cellPadding: 2.8,
      valign: "middle",
    },
    alternateRowStyles: {
      fillColor: COLORS.bgLight,
    },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 32 },
      1: { cellWidth: 38 },
      2: { fontStyle: "bold", halign: "center", cellWidth: 16 },
      3: { halign: "center", cellWidth: 20 },
      4: { halign: "center", cellWidth: 26 },
      5: { halign: "center", cellWidth: 14 },
      6: { halign: "center", cellWidth: 16 },
      7: { cellWidth: 18 },
    },
    margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || y + 50;

  // Informative footnote
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(
    "Detailed individual agent performance assessments follow sequentially starting on the next page.",
    MARGIN_LEFT,
    finalY + 10
  );
}

/* =========================================================
   SINGLE AGENT COMPLETE REPORT
   ========================================================= */

function renderSingleAgentReport(
  doc: jsPDF,
  report: AgentPerformanceReportData
) {
  // PAGE 1: EXECUTIVE SUMMARY
  renderExecutiveSummary(doc, report);

  // PAGE 2: EXAMINATION PERFORMANCE & ATTEMPT HISTORY
  doc.addPage();
  renderExamPerformanceAndHistory(doc, report);

  // PAGE 3+: FREQUENTLY MISSED QUESTIONS
  doc.addPage();
  renderFrequentlyMissedQuestions(doc, report);

  // NEXT PAGE: COMPETENCY PROFILE, KNOWLEDGE GAPS & FINAL ASSESSMENT
  doc.addPage();
  renderCompetencyAndAssessment(doc, report);
}

/* =========================================================
   PAGE 1: EXECUTIVE SUMMARY
   ========================================================= */

function renderExecutiveSummary(
  doc: jsPDF,
  report: AgentPerformanceReportData
) {
  const { summary } = report;
  let y = 25;

  // Report Document Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.brandRed);
  doc.text("QA EXAM PLATFORM", MARGIN_LEFT, y);

  y += 5.5;
  doc.setFontSize(18);
  doc.setTextColor(...COLORS.charcoal);
  doc.text("AGENT PERFORMANCE REPORT", MARGIN_LEFT, y);

  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(
    `Official Assessment & Competency Evaluation · Generated: ${formatDateTime(
      report.generatedAt
    )}`,
    MARGIN_LEFT,
    y
  );

  y += 4;
  doc.setDrawColor(...COLORS.brandRed);
  doc.setLineWidth(0.75);
  doc.line(MARGIN_LEFT, y, MARGIN_LEFT + CONTENT_WIDTH, y);

  y += 7;

  // Agent Identification Card
  doc.setFillColor(...COLORS.bgLight);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN_LEFT, y, CONTENT_WIDTH, 18, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.charcoal);
  doc.text(report.agent.name || "Agent", MARGIN_LEFT + 5, y + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(`Email: ${report.agent.email || "No email on file"}`, MARGIN_LEFT + 5, y + 11);

  doc.text(
    `Agent UID: ${report.agent.uid}   |   Enrolled: ${formatDate(report.agent.createdAt)}`,
    MARGIN_LEFT + 5,
    y + 15.5
  );

  y += 24;

  // Prominent Overall Score Banner Card
  doc.setFillColor(...COLORS.brandTint);
  doc.setDrawColor(...COLORS.brandBorder);
  doc.setLineWidth(0.5);
  doc.roundedRect(MARGIN_LEFT, y, CONTENT_WIDTH, 30, 3, 3, "FD");

  // Left side: Large Overall Score
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.brandDark);
  doc.text("OVERALL AGENT SCORE", MARGIN_LEFT + 8, y + 8);

  doc.setFontSize(26);
  doc.setTextColor(...COLORS.brandRed);
  const scoreText =
    summary.overallScore !== null ? `${summary.overallScore}%` : "—";
  doc.text(scoreText, MARGIN_LEFT + 8, y + 20);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.textMuted);
  const marksExplanation =
    summary.overallScore !== null
      ? `${summary.totalMarksEarned} marks earned out of ${summary.totalPossibleMarks} total possible marks`
      : "No eligible reviewed attempts recorded";
  doc.text(marksExplanation, MARGIN_LEFT + 8, y + 26);

  // Vertical divider line
  doc.setDrawColor(...COLORS.brandBorder);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_LEFT + 95, y + 4, MARGIN_LEFT + 95, y + 26);

  // Right side: Competency & Trend
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...COLORS.charcoal);
  doc.text("CORE COMPETENCY", MARGIN_LEFT + 102, y + 8);

  doc.setFontSize(15);
  doc.setTextColor(...COLORS.charcoal);
  doc.text(
    summary.competencyScore !== null ? `${summary.competencyScore}%` : "—",
    MARGIN_LEFT + 102,
    y + 16
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.textMuted);
  const trendLabel =
    report.trend === "improving"
      ? `Performance Trend: Improving (+${report.trendVelocity || 0}%)`
      : report.trend === "declining"
      ? `Performance Trend: Declining (${report.trendVelocity || 0}%)`
      : report.trend === "stable"
      ? "Performance Trend: Stable"
      : "Performance Trend: Need 2+ reviews for trend";
  doc.text(trendLabel, MARGIN_LEFT + 102, y + 22);

  const priorityLabel = `Coaching Priority: ${report.coaching.priority.toUpperCase()} PRIORITY`;
  doc.text(priorityLabel, MARGIN_LEFT + 102, y + 26.5);

  y += 36;

  // Executive Metric Blocks Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.setTextColor(...COLORS.charcoal);
  doc.text("KEY PERFORMANCE INDICATORS", MARGIN_LEFT, y);

  y += 4;
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_LEFT, y, MARGIN_LEFT + CONTENT_WIDTH, y);

  y += 5;

  // 14 Compact Metric Blocks arranged cleanly in a 4-column grid
  const metrics = [
    { label: "Tests Assigned", value: String(summary.totalTestsAssigned), sub: `${summary.testsAttempted} attempted` },
    { label: "Tests Completed", value: String(summary.testsCompleted), sub: `${summary.testsPending} pending` },
    { label: "Completion Rate", value: `${summary.completionRate}%`, sub: summary.completionRate >= 80 ? "On Target" : "Under Target" },
    { label: "Total Attempts", value: String(summary.totalAttempts), sub: `${summary.reviewedAttemptsCount} reviewed` },
    { label: "Average Score", value: summary.averageScore !== null ? `${summary.averageScore}%` : "—", sub: "Reviewed tests" },
    { label: "Highest Score", value: summary.highestScore !== null ? `${summary.highestScore}%` : "—", sub: "Best result" },
    { label: "Lowest Score", value: summary.lowestScore !== null ? `${summary.lowestScore}%` : "—", sub: "Lowest result" },
    { label: "Avg. Time Taken", value: formatTimeTaken(summary.averageTimeTakenSeconds), sub: "Per assessment" },
    { label: "Questions Attempted", value: String(summary.totalQuestionsAttempted), sub: "Reviewed answers" },
    { label: "Correct Answers", value: String(summary.correctAnswers), sub: summary.totalQuestionsAttempted > 0 ? `${Math.round((summary.correctAnswers / summary.totalQuestionsAttempted) * 100)}% passing` : "—" },
    { label: "Incorrect Answers", value: String(summary.incorrectAnswers), sub: summary.totalQuestionsAttempted > 0 ? `${Math.round((summary.incorrectAnswers / summary.totalQuestionsAttempted) * 100)}% missed` : "—" },
    { label: "Total Marks Earned", value: String(summary.totalMarksEarned), sub: `of ${summary.totalPossibleMarks} max` },
    { label: "Archived Tests", value: String(summary.testsArchived), sub: "Historical records" },
    { label: "Reviewed Attempts", value: String(summary.reviewedAttemptsCount), sub: `of ${summary.totalAttempts} attempts` },
  ];

  const colWidth = (CONTENT_WIDTH - 9) / 4; // 4 columns with 3mm gaps
  const cardHeight = 15;

  metrics.forEach((m, idx) => {
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const cx = MARGIN_LEFT + col * (colWidth + 3);
    const cy = y + row * (cardHeight + 3);

    doc.setFillColor(...COLORS.bgLight);
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.25);
    doc.roundedRect(cx, cy, colWidth, cardHeight, 1.5, 1.5, "FD");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.textMuted);
    doc.text(m.label.toUpperCase(), cx + 2.5, cy + 4);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.setTextColor(...COLORS.charcoal);
    doc.text(m.value, cx + 2.5, cy + 9.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(...COLORS.textLight);
    doc.text(m.sub, cx + 2.5, cy + 13);
  });

  y += Math.ceil(metrics.length / 4) * (cardHeight + 3) + 6;

  // Executive Summary Narrative Note
  doc.setFillColor(...COLORS.bgLight);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN_LEFT, y, CONTENT_WIDTH, 22, 2, 2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.charcoal);
  doc.text("EXECUTIVE AUDIT SUMMARY & METHODOLOGY", MARGIN_LEFT + 4, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.textPrimary);
  const narrative =
    `This report provides a formal performance and competency assessment for ${report.agent.name || "Agent"}. ` +
    `Overall score (${scoreText}) is calculated strictly from master scores of eligible assigned examinations (${summary.totalMarksEarned}/${summary.totalPossibleMarks} marks earned). ` +
    `Attempts are progressive contributions toward the master score of each exam. Questions with passing marks (≥70%) are mastered and non-decreasing across retakes. ` +
    `Section details for examination performance, attempt progression, repeated question weaknesses, and coaching priorities follow.`;
  const splitNarrative = doc.splitTextToSize(narrative, CONTENT_WIDTH - 8);
  doc.text(splitNarrative, MARGIN_LEFT + 4, y + 9.5);
}

/* =========================================================
   PAGE 2: EXAMINATION PERFORMANCE & ATTEMPT HISTORY
   ========================================================= */

function renderExamPerformanceAndHistory(
  doc: jsPDF,
  report: AgentPerformanceReportData
) {
  let y = 25;

  // Section Header: Examination Performance
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...COLORS.charcoal);
  doc.text("EXAMINATION PERFORMANCE", MARGIN_LEFT, y);

  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(
    `Comprehensive results across all ${report.examPerformances.length} assigned examinations and historical assessments.`,
    MARGIN_LEFT,
    y
  );

  y += 3;
  doc.setDrawColor(...COLORS.brandRed);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_LEFT, y, MARGIN_LEFT + CONTENT_WIDTH, y);

  y += 5;

  if (report.examPerformances.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(...COLORS.textMuted);
    doc.text("No examinations have been assigned to this agent.", MARGIN_LEFT, y + 6);
    y += 15;
  } else {
    // Exam Table
    const examRows = report.examPerformances.map((p) => [
      p.examName + (p.isArchived ? " (Archived)" : ""),
      p.mode === "until_perfect" ? "Until Perfect" : "Normal",
      String(p.attemptsTaken),
      p.masterScore !== null ? `${p.masterScore}/${p.masterTotalMarks}` : "—",
      p.masterPercentage !== null ? `${p.masterPercentage}%` : "—",
      p.latestAttemptGain !== null
        ? (p.latestAttemptGain > 0 ? `+${p.latestAttemptGain}` : `${p.latestAttemptGain}`)
        : "—",
      `${p.questionsMastered}/${p.questionsMastered + p.questionsRemaining}`,
      formatTimeTaken(p.timeTakenSeconds),
      p.reviewStatus,
      p.completionStatus,
    ]);

    autoTable(doc, {
      startY: y,
      head: [
        [
          "Exam Name",
          "Mode",
          "Att.",
          "Master Score",
          "Progress",
          "Gain",
          "Mastered",
          "Time",
          "Status",
          "Completion",
        ],
      ],
      body: examRows,
      theme: "striped",
      showHead: "everyPage",
      headStyles: {
        fillColor: COLORS.brandRed,
        textColor: COLORS.white,
        fontStyle: "bold",
        fontSize: 7.5,
        halign: "left",
        cellPadding: 2.5,
      },
      styles: {
        fontSize: 7,
        textColor: COLORS.textPrimary,
        cellPadding: 2.2,
        valign: "middle",
      },
      alternateRowStyles: {
        fillColor: COLORS.bgLight,
      },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 40 },
        1: { cellWidth: 18 },
        2: { halign: "center", cellWidth: 9 },
        3: { halign: "center", fontStyle: "bold", cellWidth: 20 },
        4: { halign: "center", fontStyle: "bold", cellWidth: 15 },
        5: { halign: "center", cellWidth: 14 },
        6: { halign: "center", cellWidth: 16 },
        7: { cellWidth: 14 },
        8: { cellWidth: 18 },
        9: { cellWidth: 16 },
      },
      margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
    });

    y = (doc as any).lastAutoTable?.finalY || y + 50;
  }

  // ATTEMPT HISTORY SECTION
  y += 10;
  if (y > BOTTOM_LIMIT - 35) {
    doc.addPage();
    y = 25;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.charcoal);
  doc.text("ATTEMPT HISTORY", MARGIN_LEFT, y);

  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(
    "Chronological breakdown of every assessment attempt, retake relationship, and evaluation status.",
    MARGIN_LEFT,
    y
  );

  y += 3;
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_LEFT, y, MARGIN_LEFT + CONTENT_WIDTH, y);

  y += 4;

  const allAttempts: Array<AgentAttemptRecord & { examName: string }> = [];
  report.examPerformances.forEach((p) => {
    p.attempts.forEach((a) => {
      allAttempts.push({ ...a, examName: p.examName });
    });
  });

  allAttempts.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));

  if (allAttempts.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.textMuted);
    doc.text("No attempt history recorded for this agent.", MARGIN_LEFT, y + 5);
  } else {
    const attemptRows = allAttempts.map((att) => {
      let typeLabel = att.isReattempt ? "Retake" : "Original";
      if (att.isArchivedExam) typeLabel += " (Archived)";

      const examScoreDisplay =
        att.score !== null
          ? `${att.score}%`
          : "—";

      const masterProgressDisplay =
        att.cumulativeMasterScore !== null
          ? `${att.cumulativeMasterScore} / ${att.masterTotalMarks ?? "—"}`
          : "—";

      const gainDisplay =
        att.progressGain !== null && att.progressGain !== undefined
          ? att.progressGain > 0
            ? `+${att.progressGain}`
            : `${att.progressGain}`
          : "—";

      const thisAttemptDisplay =
        att.isReattempt && att.rawAttemptMarks !== null && att.rawAttemptMarks !== undefined
          ? `${att.rawAttemptMarks}/${att.rawAttemptMaxMarks} (${att.rawAttemptScore ?? "—"}%)`
          : "—";

      return [
        att.examName,
        `#${att.attemptNumber} (${typeLabel})`,
        examScoreDisplay,
        masterProgressDisplay,
        gainDisplay,
        thisAttemptDisplay,
        formatTimeTaken(att.timeTakenSeconds),
        formatDate(att.submittedAt),
        att.status.replace(/_/g, " ").toUpperCase(),
      ];
    });

    autoTable(doc, {
      startY: y,
      head: [
        [
          "Exam Name",
          "Attempt",
          "Current Score",
          "Master Progress",
          "Gain",
          "This Attempt",
          "Time",
          "Submitted",
          "Status",
        ],
      ],
      body: attemptRows,
      theme: "striped",
      showHead: "everyPage",
      headStyles: {
        fillColor: COLORS.charcoal,
        textColor: COLORS.white,
        fontStyle: "bold",
        fontSize: 7.5,
        halign: "left",
        cellPadding: 2.5,
      },
      styles: {
        fontSize: 7,
        textColor: COLORS.textPrimary,
        cellPadding: 2.2,
        valign: "middle",
      },
      alternateRowStyles: {
        fillColor: COLORS.bgLight,
      },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 38 },
        1: { halign: "center", cellWidth: 18 },
        2: { halign: "center", fontStyle: "bold", cellWidth: 20 },
        3: { halign: "center", cellWidth: 20 },
        4: { halign: "center", cellWidth: 12 },
        5: { halign: "center", cellWidth: 22 },
        6: { cellWidth: 14 },
        7: { cellWidth: 18 },
        8: { cellWidth: 18 },
      },
      margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
    });
  }
}

/* =========================================================
   PAGE 3+: FREQUENTLY MISSED QUESTIONS
   ========================================================= */

function renderFrequentlyMissedQuestions(
  doc: jsPDF,
  report: AgentPerformanceReportData
) {
  let y = 25;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...COLORS.charcoal);
  doc.text("FREQUENTLY MISSED QUESTIONS", MARGIN_LEFT, y);

  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(
    "Questions the agent has repeatedly answered incorrectly across eligible reviewed attempts.",
    MARGIN_LEFT,
    y
  );

  y += 3;
  doc.setDrawColor(...COLORS.brandRed);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_LEFT, y, MARGIN_LEFT + CONTENT_WIDTH, y);

  y += 6;

  const missed = report.frequentlyMissedQuestions;

  if (missed.length === 0) {
    doc.setFillColor(...COLORS.bgLight);
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(MARGIN_LEFT, y, CONTENT_WIDTH, 20, 2, 2, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.emerald);
    doc.text("No Repeated Question Weaknesses Identified", MARGIN_LEFT + 5, y + 8);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.textMuted);
    doc.text(
      "The agent achieved passing marks (≥70%) on their attempted questions or has completed insufficient tests.",
      MARGIN_LEFT + 5,
      y + 14
    );
    return;
  }

  // Render each frequently missed question in a dedicated, unclipped document card
  missed.forEach((q, idx) => {
    const cleanText = stripFormatting(q.questionText);
    const itemNumber = String(idx + 1).padStart(2, "0");

    // Pre-calculate wrapped question text height
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const wrappedLines = doc.splitTextToSize(cleanText, CONTENT_WIDTH - 8);
    const textHeight = wrappedLines.length * 3.6;

    // Total block height: header (5mm) + text + stats line (5mm) + progression line (5mm) + padding
    const blockHeight = 7 + textHeight + 16;

    // Check if we need to paginate so questions don't get cut awkwardly
    if (y + blockHeight > BOTTOM_LIMIT) {
      doc.addPage();
      y = 25;
    }

    // Question Container Box
    doc.setFillColor(...COLORS.bgLight);
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.25);
    doc.roundedRect(MARGIN_LEFT, y, CONTENT_WIDTH, blockHeight, 1.5, 1.5, "FD");

    // Question Header Bar
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.brandRed);
    doc.text(itemNumber, MARGIN_LEFT + 4, y + 5);

    doc.setTextColor(...COLORS.charcoal);
    doc.text(
      `${q.module.toUpperCase()} · ${(q.topic || q.feature).toUpperCase()}`,
      MARGIN_LEFT + 12,
      y + 5
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.textMuted);
    doc.text(
      `Type: ${q.questionType.replace(/_/g, " ")}   |   Question ID: ${q.questionId}`,
      MARGIN_LEFT + 100,
      y + 5
    );

    // Exact Question Text (Clean, wrapped, full punctuation)
    let textY = y + 9.5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.textPrimary);
    doc.text(wrappedLines, MARGIN_LEFT + 4, textY);

    textY += textHeight + 2.5;

    // Statistics & Result Line
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...COLORS.textPrimary);
    const stats =
      `Attempts: ${q.timesAttempted}   |   Incorrect: ${q.timesIncorrect}   |   ` +
      `Incorrect Rate: ${q.incorrectPct}%   |   ` +
      `Latest Result: ${q.latestResult.toUpperCase()} (${q.latestScore}/${q.latestMaxMarks})`;
    doc.text(stats, MARGIN_LEFT + 4, textY);

    if (q.knowledgeGapCategory) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7);
      doc.setTextColor(...COLORS.amber);
      doc.text(`Gap: ${q.knowledgeGapCategory}`, MARGIN_LEFT + 130, textY);
    }

    textY += 4.5;

    // Progression & Mastery Status Line
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.textMuted);
    doc.text(`Progression: ${q.progressionDisplay || "—"}`, MARGIN_LEFT + 4, textY);

    doc.setFont("helvetica", "bold");
    if (q.eventuallyMastered) {
      doc.setTextColor(...COLORS.emerald);
      doc.text("● EVENTUALLY MASTERED (Resolved)", MARGIN_LEFT + 110, textY);
    } else {
      doc.setTextColor(...COLORS.rose);
      doc.text("● ACTIVE WEAKNESS (Unresolved)", MARGIN_LEFT + 110, textY);
    }

    y += blockHeight + 3.5;
  });
}

/* =========================================================
   PAGE 4: COMPETENCY PROFILE, KNOWLEDGE GAPS & FINAL ASSESSMENT
   ========================================================= */

function renderCompetencyAndAssessment(
  doc: jsPDF,
  report: AgentPerformanceReportData
) {
  const { competency, coaching, progression, summary } = report;
  let y = 25;

  // SECTION HEADER: COMPETENCY PROFILE
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...COLORS.charcoal);
  doc.text("COMPETENCY PROFILE & KNOWLEDGE GAPS", MARGIN_LEFT, y);

  y += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(
    "Evaluation of subject-matter mastery across tested functional modules and clinical knowledge categories.",
    MARGIN_LEFT,
    y
  );

  y += 3;
  doc.setDrawColor(...COLORS.brandRed);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_LEFT, y, MARGIN_LEFT + CONTENT_WIDTH, y);

  y += 5;

  // Module Competency Table (modules with loss of points < 100% shown on top)
  const sortedModules = [...(competency.moduleCompetency || [])].sort((a, b) => {
    const aHasLoss = a.score < 100;
    const bHasLoss = b.score < 100;
    if (aHasLoss && !bHasLoss) return -1;
    if (!aHasLoss && bHasLoss) return 1;
    if (a.score !== b.score) {
      return a.score - b.score;
    }
    if ((b.weakQuestions ?? 0) !== (a.weakQuestions ?? 0)) {
      return (b.weakQuestions ?? 0) - (a.weakQuestions ?? 0);
    }
    return a.module.localeCompare(b.module);
  });

  const moduleRows = sortedModules.map((m) => {
    let rating = "Proficient";
    if (m.score < 60) rating = "Critical Weakness";
    else if (m.score < 80) rating = "Moderate Gap";

    return [
      m.module,
      `${m.score}%`,
      rating,
      String(m.questionsMeasured),
      `${m.correctQuestions} passed / ${m.weakQuestions} weak`,
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [["Module", "Competency Score", "Rating", "Questions Tested", "Result Breakdown"]],
    body: moduleRows,
    theme: "striped",
    headStyles: {
      fillColor: COLORS.charcoal,
      textColor: COLORS.white,
      fontStyle: "bold",
      fontSize: 8,
      halign: "left",
      cellPadding: 2.5,
    },
    styles: {
      fontSize: 7.5,
      textColor: COLORS.textPrimary,
      cellPadding: 2.2,
      valign: "middle",
    },
    alternateRowStyles: {
      fillColor: COLORS.bgLight,
    },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 55 },
      1: { halign: "center", fontStyle: "bold", cellWidth: 28 },
      2: { cellWidth: 32 },
      3: { halign: "center", cellWidth: 25 },
      4: { cellWidth: 40 },
    },
    margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
  });

  y = (doc as any).lastAutoTable?.finalY || y + 40;

  y += 6;

  // Coaching Priorities & Knowledge Gaps Two-Column Card
  const halfWidth = (CONTENT_WIDTH - 4) / 2;
  const coachingHeight = 32;

  // Left Card: Coaching Recommendations
  doc.setFillColor(...COLORS.bgLight);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.25);
  doc.roundedRect(MARGIN_LEFT, y, halfWidth, coachingHeight, 1.5, 1.5, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.charcoal);
  doc.text("COACHING PRIORITIES", MARGIN_LEFT + 4, y + 5);

  doc.setFontSize(7.5);
  doc.setTextColor(
    coaching.priority === "high"
      ? COLORS.rose[0]
      : coaching.priority === "medium"
      ? COLORS.amber[0]
      : COLORS.emerald[0],
    coaching.priority === "high"
      ? COLORS.rose[1]
      : coaching.priority === "medium"
      ? COLORS.amber[1]
      : COLORS.emerald[1],
    coaching.priority === "high"
      ? COLORS.rose[2]
      : coaching.priority === "medium"
      ? COLORS.amber[2]
      : COLORS.emerald[2]
  );
  doc.text(`${coaching.priority.toUpperCase()} PRIORITY`, MARGIN_LEFT + halfWidth - 25, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.textPrimary);
  const primaryReasonLines = doc.splitTextToSize(
    coaching.primaryReason || "No critical weaknesses identified.",
    halfWidth - 8
  );
  doc.text(primaryReasonLines, MARGIN_LEFT + 4, y + 10);

  if (coaching.recommendedCoachingArea) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.brandRed);
    doc.text(
      `Recommended Focus: ${coaching.recommendedCoachingArea}`,
      MARGIN_LEFT + 4,
      y + 26
    );
  }

  // Right Card: Top Knowledge Gaps
  const rx = MARGIN_LEFT + halfWidth + 4;
  doc.setFillColor(...COLORS.bgLight);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.25);
  doc.roundedRect(rx, y, halfWidth, coachingHeight, 1.5, 1.5, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.charcoal);
  doc.text("IDENTIFIED KNOWLEDGE GAPS", rx + 4, y + 5);

  if (competency.knowledgeGaps.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.textMuted);
    doc.text("No specific categorized errors recorded.", rx + 4, y + 11);
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.textPrimary);
    competency.knowledgeGaps.slice(0, 4).forEach((gap, gIdx) => {
      doc.text(
        `• ${gap.category} (${gap.count} error${gap.count === 1 ? "" : "s"})`,
        rx + 4,
        y + 11 + gIdx * 4.5
      );
    });
  }

  y += coachingHeight + 8;

  // SECTION HEADER: FINAL OVERALL ASSESSMENT
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...COLORS.charcoal);
  doc.text("OVERALL ASSESSMENT & PERFORMANCE TREND", MARGIN_LEFT, y);

  y += 4;
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_LEFT, y, MARGIN_LEFT + CONTENT_WIDTH, y);

  y += 5;

  // Performance Trend Progression String
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.charcoal);
  doc.text("HISTORICAL SCORE PROGRESSION:", MARGIN_LEFT, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  if (progression.length === 0) {
    doc.setTextColor(...COLORS.textMuted);
    doc.text("Insufficient historical data for trend analysis.", MARGIN_LEFT + 55, y);
  } else {
    const chain = progression
      .slice(-8)
      .map((p) => `${p.scorePct}%`)
      .join("  →  ");
    doc.setTextColor(...COLORS.brandRed);
    doc.text(chain, MARGIN_LEFT + 55, y);
  }

  y += 7;

  // Final Assessment Summary Box
  doc.setFillColor(...COLORS.bgLight);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.25);
  doc.roundedRect(MARGIN_LEFT, y, CONTENT_WIDTH, 38, 2, 2, "FD");

  // Assessment Rows
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...COLORS.charcoal);
  doc.text("AUDITOR SUMMARY:", MARGIN_LEFT + 4, y + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.textPrimary);

  const trendWord =
    report.trend === "improving"
      ? `IMPROVING (+${report.trendVelocity || 0}%)`
      : report.trend === "declining"
      ? `DECLINING (${report.trendVelocity || 0}%)`
      : report.trend === "stable"
      ? "STABLE"
      : "INSUFFICIENT DATA";

  doc.text(
    `Overall Score: ${summary.overallScore !== null ? `${summary.overallScore}%` : "—"}   |   ` +
      `Average Score: ${summary.averageScore !== null ? `${summary.averageScore}%` : "—"}   |   ` +
      `Best Score: ${summary.highestScore !== null ? `${summary.highestScore}%` : "—"}   |   ` +
      `Lowest Score: ${summary.lowestScore !== null ? `${summary.lowestScore}%` : "—"}   |   ` +
      `Tests Completed: ${summary.testsCompleted}/${summary.totalTestsAssigned}   |   ` +
      `Total Attempts: ${summary.totalAttempts}`,
    MARGIN_LEFT + 4,
    y + 11
  );

  doc.setFont("helvetica", "bold");
  doc.text("LEARNING TREND:", MARGIN_LEFT + 4, y + 17);
  doc.setFont("helvetica", "normal");
  doc.text(trendWord, MARGIN_LEFT + 32, y + 17);

  doc.setFont("helvetica", "bold");
  doc.text("PRIMARY STRENGTHS:", MARGIN_LEFT + 4, y + 23);
  doc.setFont("helvetica", "normal");
  const strengthsText = competency.strongestModule
    ? `${competency.strongestModule.module} (${competency.strongestModule.score}% mastery)`
    : "Consistent participation across assigned assessments";
  doc.text(strengthsText, MARGIN_LEFT + 38, y + 23);

  doc.setFont("helvetica", "bold");
  doc.text("DEVELOPMENT AREAS:", MARGIN_LEFT + 4, y + 29);
  doc.setFont("helvetica", "normal");
  const devText = competency.weakestModule
    ? `${competency.weakestModule.module} (${competency.weakestModule.score}% score) · Recommended re-assessment`
    : report.frequentlyMissedQuestions.length > 0
    ? `${report.frequentlyMissedQuestions[0].module} (${report.frequentlyMissedQuestions.length} repeat question weaknesses)`
    : "Maintain high passing standards across upcoming exams";
  doc.text(devText, MARGIN_LEFT + 40, y + 29);

  doc.setFont("helvetica", "italic");
  doc.setFontSize(6.5);
  doc.setTextColor(...COLORS.textMuted);
  doc.text(
    "Official report prepared for internal QA review and employee coaching. All metrics verified via platform audit trail.",
    MARGIN_LEFT + 4,
    y + 35
  );
}

/* =========================================================
   TWO-PASS RUNNING HEADERS & FOOTERS (EVERY PAGE)
   ========================================================= */

function applyHeadersAndFooters(
  doc: jsPDF,
  reports: AgentPerformanceReportData[]
) {
  const totalPages = doc.getNumberOfPages();

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    doc.setPage(pageNum);

    // Running Top Header Line
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.textMuted);
    doc.text(
      "QA EXAM PLATFORM  ·  AGENT PERFORMANCE REPORT",
      MARGIN_LEFT,
      12
    );

    // Subtitle / context on right
    doc.text("CONFIDENTIAL AUDIT", MARGIN_LEFT + CONTENT_WIDTH, 12, {
      align: "right",
    });

    // Top Header Thin Separator
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_LEFT, 14, MARGIN_LEFT + CONTENT_WIDTH, 14);

    // Running Bottom Footer Line
    doc.setDrawColor(...COLORS.border);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_LEFT, 285, MARGIN_LEFT + CONTENT_WIDTH, 285);

    // Footer Text
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...COLORS.textLight);
    doc.text("Confidential • Auditor Report", MARGIN_LEFT, 290);

    doc.text(
      `Page ${pageNum} of ${totalPages}`,
      MARGIN_LEFT + CONTENT_WIDTH,
      290,
      { align: "right" }
    );
  }
}
