---
name: kafedra-design-audit
description: Independently audit implemented Kafedra Planner UI against the approved design and motion brief before test/release handoff.
---

# Design audit

Use this skill after UI implementation and before final test/release handoff. Do not redesign from taste and do not silently broaden scope. Read `docs/design.md`, `docs/MOTION_DESIGN.md`, the approved GRACE spec/plan, the `kafedra-design` flow specification, any `kafedra-motion` brief, the implementation diff and relevant Playwright coverage. For material document-workspace changes also apply `kafedra-ux-acceptance` as a focused evidence checklist; this role remains the independent project verdict and project contracts outrank the reusable profile.

The audit is independent from implementation: verify what is actually rendered/implemented rather than accepting the proposed design as evidence.

## Audit dimensions

- **Clarity:** primary task, object state, owner/source and next action are obvious without a manual.
- **Hierarchy:** one primary action; secondary/rare/technical controls are progressively disclosed; no card-within-card visual noise.
- **Consistency:** labels, placement, spacing, radii, typography and action order agree with adjacent screens and the stable navigation model.
- **Apple-inspired restraint:** calm density, system-like continuity, immediate response, restrained material and no decorative spectacle.
- **Motion correctness:** movement explains causality/orientation; timing is interruptible; direct manipulation is 1:1; no routine bounce; final static state remains clear.
- **Accessibility:** keyboard/focus, readable status without color/motion, target size, contrast, and `prefers-reduced-motion` fallback.
- **Responsive behavior:** full user task remains possible on desktop and mobile; mobile reduces density instead of squeezing desktop tables.
- **Operational safety:** errors preserve input; loading does not erase context; destructive/ACL actions are explicit; automation provenance remains visible.
- **Performance:** no avoidable layout thrash, full-screen blur or continuous off-screen animation; frequent interactions remain responsive.

## Verdict

Return exactly one verdict: `PASS`, `REVISE`, or `BLOCK`.

For every finding provide severity (`blocker`, `major`, `minor`), evidence (screen/state/file/test), violated design rule, and the smallest corrective change. `PASS` requires no blocker/major findings and explicit evidence for desktop, mobile and reduced-motion behavior. `REVISE` means the change can stay in scope but needs corrections. `BLOCK` means the implementation violates a product invariant, accessibility/safety constraint, approved GRACE scope or cannot be verified.

Do not treat aesthetic preference as a blocker. Do not approve based only on screenshots when interaction, focus, error or motion behavior is material. Hand concrete regression requirements to `kafedra-tests`.
