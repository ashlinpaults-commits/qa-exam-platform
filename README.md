# QA Exam Platform

Internal QA evaluation tool: auditors build exams from a question bank, agents take them, auditors manually score, everyone sees analytics.

## Setup
1. `npm install`
2. Firebase Console → new project → enable **Authentication (Email/Password)**, **Firestore**, **Storage**.
3. Copy `.env.local.example` → `.env.local`, fill in your Firebase web config (Project Settings → General → Your apps → `</>` web icon).
4. Paste `firestore.rules` into Firestore → Rules tab, publish.
5. `npm run dev` → http://localhost:3000

## Roles
- New signups default to `agent`.
- Promote someone to `auditor`: sign in as an existing auditor → **Users** tab → "Make Auditor". Bootstrapping your *first* auditor requires a manual Firestore edit (users/{uid} → role: "auditor") since no auditor exists yet.

## Loading your question bank (5000+ questions)
Two options:
- **In-app**: Question Bank → Import Excel → upload your `.xlsx`. Fine for a few hundred to a couple thousand rows.
- **Script (recommended for 5000+ rows)**: faster, no client rate-limit risk.
  ```
  npm install firebase-admin xlsx --save-dev
  # Firebase Console -> Project Settings -> Service Accounts -> Generate new private key
  # save as scripts/serviceAccountKey.json
  node scripts/importQuestions.mjs scripts/Questions_seed.xlsx
  ```
  `scripts/Questions_seed.xlsx` is your real question bank, already included — mapped by sheet name (module) → Topic/Difficulty/Question/Answer/Scenario Based/QA/Verified/Comments.

## What's built
- **Auth & roles**: email/password, agent/auditor split, route guards + Firestore security rules, admin promote-user screen
- **Question Bank**: search, filter by module/difficulty/type, infinite scroll, CRUD, Excel import (preview before commit), all 6 question types (descriptive, MCQ, true/false, image-based, case study, drag-and-drop ordering)
- **Exam Builder**: dual-panel drag-and-drop (dnd-kit), reorder, exam modes (Normal / Until Perfect 10), draft/publish, agent assignment, duplication
- **Agent Dashboard**: assigned/in-progress/completed exams, overall score %, attempts, perfect-exam count, weak/strong areas, improving indicator
- **Take Exam**: one question at a time, autosave (debounced), progress bar, per-type answer inputs
- **Auditor Review**: exam → agent → attempt → per-question manual scoring, comments, permanent score-change audit log with reason + timestamp
- **Analytics**: average/highest/lowest score, pass %, avg attempts, module performance chart, frequently missed questions, agent performance table
- **Exam statuses**: draft → published → archived (active/completed transition automatically as attempts come in — see note below)

## Honest gaps / lighter-touch areas
Flagging these so nothing surprises you in review — these work but are intentionally simple, not gold-plated:
- **Notifications**: not built. Agents see new assignments by checking their dashboard; no push/email.
- **Question version history**: `version` increments on every edit and is stored, but there's no UI to view/diff past versions yet.
- **Excel export**: `src/lib/excelExport.ts` has the export logic wired for attempts/questions, but no button triggers it from the UI yet — quick to add if you want it.
- **Exam status "active"/"completed"**: schema supports it but nothing auto-transitions status based on attempt activity yet; today it's draft → published → (manually) archived.
- **Image upload**: image-based questions take a pasted URL, not a direct upload widget. Wire to Firebase Storage if you want in-app upload.
- **"Correct %" heuristic**: a question counts as "answered correctly" if scored ≥70% of max marks — reasonable default, adjust in `src/lib/attempts.ts` `scoreAnswer()` if you want different logic.

## Roadmap if you want to keep going
1. Notifications (in-app toast + optional email via Firebase Functions)
2. Version history viewer + diff
3. Wire up Excel export buttons
4. Auto status transitions (published → active on first attempt, → completed when all assigned agents finish)
5. Direct image upload to Storage for image-based questions
