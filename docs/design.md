# Kafedra Planner design guide

## Product character

Kafedra Planner is a calm, offline-first operational workspace for a department. People arrive to answer one practical question: **what needs attention, who owns it, what proves it, and what happens next?** The interface should make that answer visible before it offers configuration.

The system is not a generic document editor, project-management clone, or analytics playground. It is the reliable source of truth for plans, assignments, meetings, documents, evidence, and reporting. Preserve source, provenance, permissions, and history; never trade those properties for a visually shorter path.

The visual and interaction character is **Apple-inspired**, not an imitation of Apple products: clear hierarchy, calm density, immediate response, stable geometry, restrained material, continuity between states, readable typography, and movement that explains rather than entertains. Do not copy Apple assets, proprietary screens, or platform-only interaction conventions that conflict with a desktop/mobile web application on Astra Linux/Debian.

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
11. **Continuity over spectacle.** When an object persists across states, make its relationship visible through position, bounds, emphasis or a short transition. Do not replace useful continuity with unrelated entrance effects.
12. **Immediate response.** Input must visibly respond without decorative delay. Frequent operational controls should feel direct and near-critically damped, not bouncy.
13. **Motion is explanatory.** Animation is optional unless it improves causality, orientation, direct manipulation or feedback. Static before/after states remain fully understandable and `prefers-reduced-motion` is designed explicitly.

## Apple-inspired visual language

The goal is the useful discipline associated with high-quality system UI: obvious action hierarchy, generous but not wasteful spacing, coherent surfaces, precise alignment, readable type, predictable focus, and subtle depth.

- Prefer one dominant surface and one clear inspector/detail layer rather than many nested cards.
- Use system font stacks already available on the target OS. Do not introduce a remote font merely to imitate another platform.
- Use radius, shadow, translucency and separators consistently. Depth is a hierarchy cue, not decoration.
- Keep primary actions visually distinct but not oversized. Secondary actions should remain discoverable without competing with the task.
- Do not create “glass everywhere”. Blur/translucency is allowed only when it clarifies layering and preserves contrast; full-screen blur is prohibited by default.
- Avoid gradients, glossy highlights, 3D rotation, particles and dramatic scaling in dense operational screens unless the interaction has a concrete spatial reason.
- A control must still look actionable and a status must still be readable in a static screenshot, high-contrast mode, and reduced-motion mode.
- Interactive targets should normally provide at least a 44×44 CSS-pixel effective area where layout allows it.

## Information architecture and layout

- Keep the primary areas fixed: Calendar, Documents, Plans, Assignments, Plan / Fact, Meetings, Science, and Review.
- Use an overview for scanning and a consistent inspector/detail view for reading, editing, provenance, history, and linked objects. Do not create alternate editors for the same object.
- Put the page title, active period or scope, key state, and primary action near the top. Put destructive actions last and visually separate them.
- Keep filters near the result they affect and make active filters visible and reversible. Filter changes are `rank-only`: preserve neutral and saved values.
- Tables support operational scanning: stable columns, readable dates, status text, and direct links to the underlying object. On mobile, turn secondary columns into labelled detail rather than squeezing them into illegible cells.
- Forms follow the work sequence: identity and source, responsibility and timing, expected result/evidence, then optional metadata. Required fields are clear before submission. Existing saved values outrank learned defaults.
- Avoid duplicate toolbars. A visible action should have one predictable home unless a second entry point is essential for a different workflow context.

## Interaction rules

- Every primary action uses a specific verb: “Create assignment”, “Attach evidence”, “Confirm report”. Avoid generic “Save” when the operation has a more meaningful name.
- A successful action reports the persisted result and offers the natural next step. Do not claim success until the domain transaction is committed.
- Status is semantic and readable in text. Colour palettes must preserve contrast and remain understandable without colour.
- Empty states tell the user why the area is empty and offer the smallest relevant next action; they never invent sample business data.
- Loading states preserve context. Errors explain the recovery action in user terms and do not discard local input.
- Keyboard focus, labels, target sizes, and contrast must remain usable. Test the implemented flow with keyboard and at desktop/mobile Playwright viewports.
- Repeated clicks/taps must not create duplicate domain operations; visual feedback may start immediately, but completion state follows persisted truth.
- In-flight visual transitions must be interruptible or retargetable. Never leave the hit target in a different logical place from the rendered control.

## Motion contract

All visible motion is governed by `docs/MOTION_DESIGN.md`. The `kafedra-motion` specialist selects references from `docs/design/reactiive-motion-catalog.md` and produces a measurable motion brief. It may explicitly return `no-motion`.

For direct manipulation, visual progress follows pointer/finger progress 1:1 while the gesture is active. Spring/snap/decay may start after release. Routine navigation, filter, save and checkbox flows should not have conspicuous bounce.

The Reactiive catalog is an inspiration/retrieval source. A catalog entry is not authority for an exact constant: when a demo is selected, inspect the current upstream source before claiming exact duration, easing, spring, threshold, opacity or blur values. Keep upstream evidence separate from Kafedra recommendations.

Every motion brief and implementation must define:

- trigger and state machine;
- progress source and properties changed;
- timing/easing/spring or direct gesture mapping;
- interruption/cancellation behavior;
- desktop/mobile behavior;
- `prefers-reduced-motion` fallback;
- performance budget and static fallback where an expensive effect is proposed;
- observable acceptance criteria.

## Specialist design lifecycle inside GRACE 4

For a GRACE change whose `ObservedWriteScope` touches `public/**`, the approved plan must route the UI work in this order:

```text
kafedra-flow-intake (when flow changes)
  → kafedra-design
  → kafedra-motion
  → kafedra-feature
  → kafedra-design-audit
  → kafedra-tests
  → kafedra-release / GRACE final
```

`kafedra-motion` is mandatory as a decision point for UI changes but may conclude that no animation should be added. `kafedra-design-audit` happens **after implementation** and is independent of the design/feature proposal. It returns `PASS`, `REVISE`, or `BLOCK` with evidence; `PASS` requires explicit desktop, mobile and reduced-motion evidence for material UI changes.

`scripts/design-governance.mjs` is the fail-closed repository check for this routing. It does not replace human/product judgment; it prevents a UI-scoped GRACE plan from silently omitting the required specialist stages.

## Responsive behavior

Desktop and mobile express the same domain workflow with different density.

- Desktop may keep persistent side navigation, wider tables and a simultaneous inspector.
- Mobile keeps fixed primary navigation and converts secondary columns into labelled stacked detail or disclosure.
- Do not hide the only completion action behind hover.
- Do not require horizontal table scanning for the normal mobile task when a labelled stacked representation is practical.
- The same saved object, permission, evidence and status semantics apply at every viewport.

## Accessibility and reduced motion

Accessibility is part of the design contract rather than a final polish pass.

- Meaning is never encoded only by colour, blur, position, animation or haptic feedback.
- Focus order follows reading/task order and remains visible through transitions.
- Modal/sheet focus is contained while open and restored to a logical origin on close.
- `prefers-reduced-motion: reduce` removes large travel, parallax, repeated movement, rotation, procedural waves and motion blur. Necessary state feedback may remain as a short non-spatial opacity/color change.
- Error and success states are announced/readable independently of animation.
- A disabled control must explain the missing prerequisite nearby when that prerequisite is not obvious.

## Adaptive UX boundary

Every new or changed adaptive control remains in one of the four classes defined by `docs/ADAPTIVE_UX.md`: `safe-default`, `rank-only`, `domain-derived`, or `never-learn`.

Frequency may rank safe options; it never moves primary controls, rewrites ACL/security decisions, learns arbitrary business text, overrides saved/domain-derived values, or converts an automatic proposal into a user choice. Programmatic defaults do not count as user selections.

## Design handoff

`kafedra-design` produces: entry point, user goal, visible facts, primary action, secondary disclosure, validation/error/empty/loading states, source/provenance, desktop/mobile behavior, accessibility constraints, and acceptance criteria.

If movement is involved or the UI changes state visually, `kafedra-motion` adds a motion brief. `kafedra-feature` implements within the approved GRACE scope. `kafedra-design-audit` then reviews the actual implementation and sends concrete regression requirements to `kafedra-tests`.

A new persisted fact, lifecycle or projection still requires `kafedra-data`; design roles do not invent schema semantics.

## UX acceptance review

The intake/designer/auditor can mark a proposal or implementation acceptable only when the material answers are yes:

- Is the user goal, actor, source of truth, permission boundary, and completion evidence explicit?
- Does it reuse an existing domain object and navigation path, or justify a genuinely new lifecycle?
- Is the primary action obvious without a manual, and are labels, placement, state, and next step understandable?
- Is the action placement consistent with adjacent screens and safe on desktop and mobile?
- Does the flow preserve provenance, audit/history, idempotency, saved values, and ACL semantics?
- Does adaptive behaviour obey the four UX classes and leave geometry unchanged?
- Are error, empty, loading, offline/degraded-capability, and repeat-submission states designed and tested?
- If motion exists, does it improve causality/orientation, remain interruptible, and have an explicit reduced-motion fallback?
- Does the final implementation preserve clarity in a static frame and under keyboard navigation?

An acceptable review is an evidence-backed decision, not aesthetic approval. Record assumptions, risks, and the minimum tests that demonstrate the flow.
