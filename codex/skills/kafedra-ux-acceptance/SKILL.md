---
name: kafedra-ux-acceptance
description: Audits implemented Kafedra Planner document-workspace UI for work-object clarity, provenance, partial success, interaction recomposition, stable adaptive behavior, responsive parity, motion/reduced-motion and source-of-truth preservation.
---

# Kafedra UX Acceptance

Run after material Kafedra/document-workspace implementation. This is an evidence-backed implementation audit, not aesthetic approval.

Return `PASS`, `REVISE` or `BLOCK` with concrete evidence and regression requirements.

## 1. Operational clarity

Verify:

- the authoritative object is obvious;
- identity/state/responsibility/time/origin are understandable;
- the primary domain action is visible and specifically named;
- technical metadata does not dominate the common path.

## 2. Source/provenance

Verify:

- source/version/evidence remains reachable;
- manual correction does not erase raw extraction;
- search/calendar/report/review routes land on or update the authoritative object;
- archived/successor relationships do not rewrite historical provenance.

Missing provenance access is a blocker for source-derived facts.

## 3. Intake and async behavior

Test the real state machine:

- immediate per-file feedback;
- source-saved vs processing distinction;
- one file/row failure does not block others;
- partial success summary is truthful;
- targeted retry reuses persisted source and is idempotent;
- optional OCR/preview/LLM failure degrades locally.

## 4. Interaction fragmentation

Map the common path and count unnecessary decisions. If several controls implement one user intent, verify Interaction Recomposition was applied. Derived values should not remain independent selectors without a domain reason.

## 5. Review semantics

Review contains genuine ambiguity/exceptions. Safe deterministic results must not wait for a generic human `Accept` step. Correcting one exception preserves source context and does not force full re-import.

## 6. Completion/lifecycle

For assignments, confirm direct completion remains possible when permitted and optional evidence does not become a hidden prerequisite. Archive/restore or other consequential transitions show the object/consequence when confirmation is justified and preserve history.

## 7. Adaptive UX

For every changed adaptive control, verify its `safe-default / rank-only / domain-derived / never-learn` classification and precedence. Programmatic defaults must not count as user learning. Geometry/nav/action placement must remain stable.

## 8. Responsive parity

At supported desktop and mobile widths verify:

- same object/state/primary action/source/recovery semantics;
- no hover-only required action;
- tables transform rather than becoming unreadably squeezed when practical;
- list/detail Back restores useful context;
- touch targets/focus remain usable.

## 9. Motion

If motion exists, verify purpose, trigger, interruption, timing/gesture mapping, static clarity, reduced-motion and performance. Routine work must not incur decorative delay. `no-motion` is acceptable.

## 10. Error/recovery and idempotency

Exercise repeated clicks/retries, temporary failures, cancellation and offline/optional-capability loss. User input and committed sources must survive recoverable errors; repeated operations must not create duplicates.

## Required evidence

For material UI changes collect at least:

- implemented flow path/screens or test selectors;
- desktop behavior;
- mobile behavior;
- keyboard/focus where relevant;
- reduced-motion behavior if motion changed;
- partial/error/retry behavior for async flows;
- source/provenance path;
- duplicate/idempotency regression when an operation can be retried.

## Patterns

- Independent audit after implementation.
- Domain/source-of-truth checks before visual polish.
- Decision-count and control-fragmentation review.
- Desktop/mobile/reduced-motion evidence.
- Failure/idempotency evidence, not happy path only.

## Anti-patterns

- `PASS` because the screen looks cleaner.
- Self-certification by the author without checking implemented states.
- Screenshot-only review of async/import behavior.
- Ignoring mobile or reduced motion.
- Treating source/evidence loss as a minor visual issue.
- Calling a batch flow correct without testing partial failure/retry.
- Accepting a generic dashboard because individual components are polished.
