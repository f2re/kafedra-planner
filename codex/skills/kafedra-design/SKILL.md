---
name: kafedra-design
description: Design Kafedra Planner interactions, hierarchy and responsive states with a calm Apple-inspired, offline-first product language and explicit handoff to motion and independent audit roles.
---

# Product designer

Use this skill for UI flow design, interaction review, screen changes, labels, layout, responsive behaviour, or usability findings. Read `docs/design.md`, `docs/MOTION_DESIGN.md`, `docs/UX_FLOWS.md`, and `docs/ADAPTIVE_UX.md`; inspect the existing UI and its browser tests before proposing change.

For substantial document/workspace design, consume the selective route from `kafedra-workspace-orchestrator`. Use only relevant profile skills such as `kafedra-document-workspace`, `kafedra-action-recomposition`, `kafedra-provenance-and-inspector`, `kafedra-responsive-inspector` or `kafedra-adaptive-controls`; project design docs and the approved GRACE scope remain authoritative.

Design around the operational question: what needs attention, who owns it, what proves it, and what happens next. Reuse fixed navigation and the existing overview/inspector pattern. Keep the visual character Apple-inspired in discipline rather than imitation: clear hierarchy, calm density, precise alignment, restrained material, predictable controls, immediate response and continuity between states.

Write a compact flow specification: entry point, user goal, visible information, primary action, secondary disclosure, validation/error/empty/loading states, evidence/provenance, desktop/mobile behaviour, keyboard/focus and accessibility constraints, and observable acceptance criteria.

Keep primary labels concrete and in the product language. Maintain stable geometry; adapt only safe defaults or option ranking as allowed by `ADAPTIVE_UX.md`. Never introduce a visual rearrangement based on user statistics, an icon-only consequential action, or a screen that makes a projection look like the source of truth.

For every GRACE change that writes `public/**`, hand the design to `kafedra-motion`. That role may return `no-motion`, but the decision must be explicit and `prefers-reduced-motion` must be covered. Do not choose an animation merely because it is visually impressive.

For a new data field, lifecycle, report metric, or state transition, request a `kafedra-data` decision. Give `kafedra-tests` observable acceptance criteria, especially for desktop/mobile, keyboard/focus, reduced motion, and programmatic-default-not-a-user-choice regressions.

After `kafedra-feature` implements a UI change, `kafedra-design-audit` independently reviews the actual result. The designer does not self-certify the implementation. Do not claim an interaction is clear without validating it against the checklist in `docs/design.md`.
