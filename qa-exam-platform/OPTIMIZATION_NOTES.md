# Firestore / Performance Optimization

This build keeps the existing exam, review, analytics, assignment, and question-bank functionality while reducing unnecessary Firestore traffic.

## Main changes

- Persistent multi-tab Firestore cache is enabled in web browsers.
- Agent exam question loading uses batched `documentId in (...)` queries instead of one RPC per question.
- Agent exam startup checks only the latest attempt instead of downloading the agent's entire attempt history.
- The attempt created/resumed during exam startup is read from local cache when available, avoiding an immediate duplicate server read.
- Agent answer autosave is debounced to 2 seconds and writes are serialized to avoid overlapping full-answer writes.
- Navigation and submission flush the current answer so the existing autosave behavior is preserved.
- Review question lookups use batched queries.
- Final review finalization commits the attempt status and question analytics in one atomic batch.
- Saving one review question updates local review state instead of re-fetching every attempt after every save.
- Question-bank search and filters are entirely client-side after one initial question-bank load. Typing in search no longer causes Firestore requests.
- Question-bank filters include module, feature, difficulty, question type, and tag.
- A manual Refresh button is available when the auditor needs the latest question bank from Firestore.
- Expired date-based Firestore rules were replaced with authenticated-user access so the database does not suddenly lock itself because a hard-coded date passed.
- Added the composite index required for latest-attempt lookup.

## Important billing note

Firestore billing is based on document reads/writes, so batching does not magically turn 10 document reads into 1 billable read. The optimization reduces repeated/unnecessary reads, request bursts, and duplicate work. Persistent caching can avoid repeated server reads for data already cached on the device.

## Environment

`.env.local` is intentionally not included in the source ZIP. Keep your existing local `.env.local` and copy its values into any new environment where needed.
