# Phase 6 — Security & Final Production Check

Date: 2026-08-22 (Asia/Calcutta)

## Executive decision

**Not production ready.** The original Firestore rules were an expired, public
read/write catch-all. They have been replaced with deny-by-default,
role-aware rules, but the current client data model cannot safely support the
agent exam flow with Firestore rules alone.

## Critical issues fixed

- Removed the public `allow read, write` catch-all and the expired timestamp
  rule.
- Added explicit permissions for `users`, `questions`, `exams`, and
  `attempts`.
- Agents cannot create auditor profiles, change their identity fields, edit
  questions, edit exams, delete data, or update attempt score/review fields.
- Historical attempts cannot be deleted by the client.
- Auditor review writes preserve attempt identity and original timing fields.
- Agent attempt updates are restricted to the submit transition. This
  intentionally prevents score tampering, but also means the existing
  client-side answer autosave is currently rejected.
- Added visible error handling for auth/profile loading, question deletion,
  exam save/archive/delete/duplicate, agent assignment, review-data loading,
  answer autosave, attempt loading, and submission.
- Existing transaction protections for deterministic attempt creation,
  duplicate submission, per-question review saves, and question analytics
  updates were retained.

## High-risk issues remaining

1. **Agent question data is not safely separated from answer keys.**
   `Question` contains `expectedAnswer`, `correctOptionIndex`, and ordering
   data, while the agent UI loads full question documents/snapshots. Firestore
   rules cannot hide individual fields. The new rules correctly deny agents
   direct question reads, so the current agent flow cannot complete.
2. **Attempt documents contain full question snapshots and are readable by
   the owning agent.** This can expose answer keys through the browser even
   after the attempt is created. A sanitized agent-question projection and a
   protected answer-key/review model are required.
3. **Answer autosave requires a server-side or separately secured write path.**
   Firestore rules cannot safely validate that only `agentAnswer` changed
   inside an arbitrary array element. Do not loosen the rule to restore the
   current autosave implementation.
4. **Role administration has no explicit admin role or last-auditor
   protection.** Any auditor can change another user's role. This is
   functional authorization, not a safe production admin boundary.

## Verification matrix

| Area | Result |
|---|---|
| Question create/edit/delete | Code paths have error reporting; Firestore permission behavior **NOT VERIFIED** |
| Exam assign | Code path has error reporting; Firestore permission behavior **NOT VERIFIED** |
| Agent takes exam | **NOT VERIFIED / BLOCKED by secure rules** |
| Submit / duplicate submit | Transaction is present; end-to-end Firebase test **NOT VERIFIED** |
| Auditor review / finalize | Transaction and conflict protection are present; end-to-end test **NOT VERIFIED** |
| Analytics update | Per-question transactions and one-time flag are present; end-to-end test **NOT VERIFIED** |
| Until Perfect / next attempt | **NOT VERIFIED** |
| Historical attempts | Delete is denied by rules; retention behavior against a live Firebase project **NOT VERIFIED** |
| Network interruption / refresh / stale data | Some transactional guards exist; browser failure-injection test **NOT VERIFIED** |
| Simultaneous auditor edits | Per-question draft transaction addresses stale-array overwrite; live two-browser test **NOT VERIFIED** |

## Firebase quota risks

- Question-bank and module loading read entire collections.
- Review analytics performs one transaction per question, sequentially.
- Client-side autosave can generate frequent writes when its secured write path
  is restored.
- No live quota/load test was possible; quota headroom is **NOT VERIFIED**.

## Concurrency status

Attempt creation and submission use transactions and deterministic IDs.
Per-question review saves avoid stale whole-attempt overwrites. Analytics
question updates use transactions. Cross-document finalization (attempt plus
all question stats) is not atomic; partial analytics failure remains possible.

## Data integrity status

Historical attempt deletion is denied. Question snapshots preserve historical
context in the current model, but also create the answer-key exposure described
above. No live data-integrity test was possible. **NOT VERIFIED**.

## Security status

The expired public rules vulnerability is fixed in the checked-in rules.
Agent score/review mutation and historical attempt deletion are denied.
Field-level answer-key separation and the complete live permission matrix are
**NOT VERIFIED** and remain blocking issues.

## Analytics scalability

The current design is suitable only for a small question bank and low review
volume. It is not ready for high-volume finalization without server-side
aggregation, retry/repair handling, and quota/load testing.

## Known technical debt

- Split agent-safe question content from protected answer keys.
- Move agent answer writes and submission finalization behind trusted
  server-side operations or secured subcollections.
- Add Firebase Emulator Suite rules tests for every role and failure case.
- Add an explicit admin role and auditable role-change policy.
- Make analytics finalization a retryable, idempotent server workflow.
- Add offline/refresh recovery and a visible draft-save conflict state.

---

## Phase 6 continued — fixes applied on top of the above

The blocking issue from "High-risk issues remaining" #1/#2 above (agents
locked out of `questions`, with no safe path to build the exam-taking UI) has
been closed: `ExamBuilder.handleSave` now publishes a redacted per-question
snapshot (`expectedAnswer: ""`, `correctOptionIndex` omitted) into
`exams/{id}.questionSnapshots`, which agents can read via the existing
`exams` rule. `startAttempt` reads from that instead of `questions/{id}`.
Agents never read the `questions` collection at any point in the exam-taking
flow. This was already in place in the build I started from — verified
correct by code/rules review, not just present.

### Bugs found and fixed this pass

1. **Auditor review/report showed a blank "Expected Answer".** Because the
   frozen per-attempt `questionSnapshot` is now correctly redacted (no
   answer key, to close the leak), `ReviewScreen.tsx` and
   `ExamResultsScreen.tsx` — which both preferred that snapshot via `??` —
   lost the grading reference entirely for every new attempt. Fixed: both
   now merge the live, auditor-only `expectedAnswer`/`correctOptionIndex`
   (from the same `questions` fetch these screens already make) back onto
   the frozen snapshot, keeping historical question text/options/type frozen
   while restoring the grading reference. **Trade-off, not a bug:** the
   reference answer shown is the *current* Question Bank answer, not
   necessarily what was correct at the moment the agent answered — freezing
   the real answer key anywhere agent-readable would reopen the leak, so
   this is the correct compromise given the constraint.
2. **Firestore rule gap: nested `marks` injection at attempt creation.** The
   `attempts` create rule only checked top-level document keys
   (`!hasAny(["marks", "totalMarks", ...])`), not fields nested inside each
   `answers[]` array entry. A client could have crafted a create request with
   pre-seeded `marks`/`scoreHistory`/`knowledgeGapCategory` on an individual
   answer, undetected by the top-level check. Fixed with an `exists()` check
   over `answers` in the create rule.
3. **No protection against demoting the last auditor.** Any auditor could
   demote every other auditor (including themselves) with no warning,
   locking the whole team out of review/admin screens — Firestore rules
   alone can't cheaply enforce "at least one auditor must remain" without a
   maintained count or a Cloud Function. Added a client-side guard in
   `AdminUsersScreen` that blocks the specific demotion that would leave
   zero auditors, with a clear message. This is a soft guard (a client
   calling the SDK directly could still bypass it) — see remaining risks.
4. Stale rule comment on `questions/{questionId}` (still described the
   agent-workflow gap as unsolved) updated to describe the actual mechanism
   now in place.

### Operational step required before existing exams work

`questionSnapshots` is only populated when an exam is saved through
`ExamBuilder` under this code. **Any exam created/published before this
change has no `questionSnapshots` and will block every agent** who tries to
take it, with an error telling them to "ask an auditor to republish it" —
this is handled gracefully (clear message, not a silent failure or crash),
but it does mean: **an auditor must open and re-save each existing exam once**
(no content changes needed — opening `ExamBuilder` and hitting Save/Publish
is enough) before agents can take it under these rules. New exams created
going forward need no action.
