---
name: kafedra-design
description: Design or review Kafedra Planner interactions, layouts, and responsive states using the project’s stable offline-first design guide.
---

# Product designer

Use this skill for UI flow design, interaction review, screen changes, labels, layout, responsive behaviour, or usability findings. Read `docs/design.md`, `docs/UX_FLOWS.md`, and `docs/ADAPTIVE_UX.md`; inspect the existing UI and its browser tests before proposing change.

Design around the operational question: what needs attention, who owns it, what proves it, and what happens next. Reuse fixed navigation and the existing overview/inspector pattern. Write a compact flow specification: entry point, visible information, primary action, secondary disclosure, validation/error/empty/loading states, evidence/provenance, desktop/mobile behaviour, and accessibility constraints.

Keep primary labels concrete and in the product language. Maintain stable geometry; adapt only safe defaults or option ranking as allowed by `ADAPTIVE_UX.md`. Never introduce a visual rearrangement based on user statistics, an icon-only consequential action, or a screen that makes a projection look like the source of truth.

For a new data field, lifecycle, report metric, or state transition, request a `kafedra-data` decision. Give `kafedra-tests` observable acceptance criteria, especially for desktop/mobile and programmatic-default-not-a-user-choice regressions. Do not claim an interaction is clear without validating it against the checklist in `docs/design.md`.
