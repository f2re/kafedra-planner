# Kafedra Planner design guide

## Product character

Kafedra Planner is a calm, offline-first operational workspace for a department. People arrive to answer one practical question: **what needs attention, who owns it, what proves it, and what happens next?** The interface should make that answer visible before it offers configuration.

The system is not a generic document editor, project-management clone, or analytics playground. It is the reliable source of truth for plans, assignments, meetings, documents, evidence, and reporting. Preserve source, provenance, permissions, and history; never trade those properties for a visually shorter path.

## Design principles

1. **Start from work, not modules.** The calendar is the default entry point. A person can move naturally from a deadline or plan item to its assignment, evidence, decision, and report.
2. **One object, one home.** Reuse the existing document, plan-item, assignment, meeting, evidence, and report flows. A new screen or entity needs a clear lifecycle and an owner; projections must link back to their source rather than becoming editable copies.
3. **Recognition before recall.** Use plain Russian labels, visible status, due date, owner, origin, and next action. Explain unfamiliar terms in place. Avoid icon-only controls for meaningful actions.
4. **Progressive disclosure.** Show the common action and essential facts first; place history, technical metadata, rare settings, and advanced filters behind a predictable disclosure. Do not hide validation errors, blockers, or irreversible consequences.
5. **Evidence is part of the task.** Where a decision or reported result needs proof, make the current evidence state visible and linkable. Never imply that an extracted or LLM candidate is confirmed.
6. **Calm density.** Prefer a clear list, calendar, summary, or inspector over cards nested inside cards. Use whitespace and typography to group related facts; use colour as a secondary cue, never as the only status signal.
7. **Stable geometry.** Navigation, major actions, tab order, and screen hierarchy do not move based on usage. Adaptive UX may safely suggest a default or rank options only under `docs/ADAPTIVE_UX.md`; it may not reshape the UI.
8. **Forgiving, explicit operations.** Preserve form input after an error, make retries idempotent, and state what was saved. Confirm destructive or approval/return decisions with the object and consequence, not a vague warning.
9. **Desktop and mobile are equal workflows.** Desktop uses the persistent side navigation; mobile uses the fixed bottom tabs. The primary task, state, and next action remain available at every supported width; only density and secondary detail change.
10. **Offline confidence.** Do not rely on CDN assets, remote fonts, live third-party content, or connectivity for an essential step. Optional capabilities must have honest diagnostics and leave the core workflow usable.

## Information architecture and layout

- Keep the primary areas fixed: Calendar, Documents, Plans, Assignments, Plan / Fact, Meetings, Science, and Review.
- Use an overview for scanning and a consistent inspector/detail view for reading, editing, provenance, history, and linked objects. Do not create alternate editors for the same object.
- Put the page title, active period or scope, key state, and primary action near the top. Put destructive actions last and visually separate them.
- Keep filters near the result they affect and make active filters visible and reversible. Filter changes are `rank-only`: preserve neutral and saved values.
- Tables support operational scanning: stable columns, readable dates, status text, and direct links to the underlying object. On mobile, turn secondary columns into labelled detail rather than squeezing them into illegible cells.
- Forms follow the work sequence: identity and source, responsibility and timing, expected result/evidence, then optional metadata. Required fields are clear before submission. Existing saved values outrank learned defaults.

## Interaction rules

- Every primary action uses a specific verb: “Create assignment”, “Attach evidence”, “Confirm report”. Avoid generic “Save” when the operation has a more meaningful name.
- A successful action reports the persisted result and offers the natural next step. Do not claim success until the domain transaction is committed.
- Status is semantic and readable in text. Colour palettes must preserve contrast and remain understandable without colour.
- Empty states tell the user why the area is empty and offer the smallest relevant next action; they never invent sample business data.
- Loading states preserve context. Errors explain the recovery action in user terms and do not discard local input.
- Keyboard focus, labels, target sizes, and contrast must remain usable. Test the implemented flow with keyboard and at desktop/mobile Playwright viewports.

## UX acceptance review

The intake reviewer can mark a proposal **acceptable** only when it can answer yes to all material questions:

- Is the user goal, actor, source of truth, permission boundary, and completion evidence explicit?
- Does it reuse an existing domain object and navigation path, or justify a genuinely new lifecycle?
- Is the primary action obvious without a manual, and are labels, placement, state, and next step understandable?
- Is the action placement consistent with adjacent screens and safe on desktop and mobile?
- Does the flow preserve provenance, audit/history, idempotency, saved values, and ACL semantics?
- Does adaptive behaviour obey the four UX classes and leave geometry unchanged?
- Are error, empty, loading, offline/degraded-capability, and repeat-submission states designed and tested?

An acceptable review is an evidence-backed decision, not aesthetic approval. Record assumptions, risks, and the minimum tests that demonstrate the flow.
