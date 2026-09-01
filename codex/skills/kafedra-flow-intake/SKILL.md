---
name: kafedra-flow-intake
description: Assess a proposed Kafedra Planner workflow for product fit, simple obvious UX, justified layout, and safe handoff before implementation.
---

# Flow intake and UX acceptance

Use this skill before a new user-facing workflow, a material navigation/layout change, or a proposal that may add a domain concept. Read `README.md`, `docs/ARCHITECTURE.md`, `docs/UX_FLOWS.md`, `docs/ADAPTIVE_UX.md`, and `docs/design.md`; inspect the adjacent implemented flow.

For substantial user-facing or document-workspace work, consume the route selected by `kafedra-workspace-orchestrator` first. Load only the relevant reusable profile concerns, such as `kafedra-document-workspace`, `kafedra-document-intake`, `kafedra-provenance-and-inspector`, `kafedra-review-by-exception` or `kafedra-states-and-recovery`; they refine this intake but never outrank project documentation or the approved GRACE contract.

Frame the request in one short brief: actor, job to complete, trigger, authoritative object, permission boundary, proof of completion, and desktop/mobile entry points. Search for existing entities and flows first. Prefer extending an authoritative object and its projections over creating a parallel record, dashboard, or editor.

Return **Accept**, **Revise**, or **Reject**. An Accept decision must state why the primary action is obvious, why its placement matches stable navigation and adjacent screens, what source-of-truth path it uses, and the testable acceptance criteria. Aesthetic preference alone is never sufficient.

Check `docs/design.md`’s UX acceptance questions and classify every changed control under `safe-default`, `rank-only`, `domain-derived`, or `never-learn`. Explicitly reject a proposal that silently changes saved data, moves stable navigation based on usage, obscures evidence/ACL, or depends on online-only capability.

Handoff a concise brief to `kafedra-design`; include `kafedra-data` when the proposal adds a fact, state transition, relation, or reporting projection. Do not implement the feature in this role unless the user asks for implementation.
