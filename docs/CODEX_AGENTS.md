# Codex project roles

These roles are implemented as repository-local skills in `codex/skills/`. Invoke the named role for focused work, or use the handoff sequence below for a feature that crosses layers. Roles advise or implement only within the user’s authorization; release and production actions always require explicit confirmation.

| Role / skill | Owns | Produces | Must involve next |
|---|---|---|---|
| Flow intake & UX acceptance / `kafedra-flow-intake` | Problem framing, navigation fit, UX acceptance | A short accept / revise / reject decision with evidence and risks | Designer before UI work; feature delivery after acceptance |
| Product designer / `kafedra-design` | Interaction design, information hierarchy, Apple-inspired visual character, responsive states | Flow specification and UI acceptance criteria | `kafedra-motion` for every UI-scoped GRACE change; data steward if a new fact/state is implied |
| Motion advisor / `kafedra-motion` | Motion intent, reference retrieval, timing/geometry/material, gestures, reduced motion, performance | A measurable motion brief or explicit `no-motion` decision | Feature delivery; design audit after implementation |
| Data steward / `kafedra-data` | Entity ownership, schema, migrations, data invariants | Schema decision, migration plan, verification/rollback impact | Feature delivery and test engineer |
| Feature delivery / `kafedra-feature` | Minimal end-to-end implementation and integration | Working vertical slice with docs and focused verification | `kafedra-design-audit` after UI implementation; other relevant specialist roles before merge |
| Design audit / `kafedra-design-audit` | Independent post-implementation UX, motion, accessibility and responsive review | `PASS`, `REVISE`, or `BLOCK` with evidence and regression consequences | Test engineer after PASS; feature/design roles for REVISE/BLOCK |
| Test engineer / `kafedra-tests` | Risk-based unit, integration, browser, and release regression coverage | Executable test plan and test changes | Feature delivery for gaps; release operator for release-surface changes |
| Release operator / `kafedra-release` | Versioning, artifact, migration rollout, backup/restore, deployment and rollback gates | Go / no-go evidence and an operator runbook delta | Test engineer and data steward before a release-impacting merge |

## Автоматический Kafedra profile preflight

Every substantial change first passes the repository/GRACE preflight and then reads `kafedra-workspace-orchestrator`. The orchestrator is a classifier, not a new authority: it chooses the minimum relevant focused skills from `codex/skills/kafedra-profile.json`, while the eight project-local roles in the table above continue to own decisions and implementation inside the approved GRACE scope.

```text
repository + GRACE preflight
        ↓
kafedra-workspace-orchestrator
        ↓
select minimum focused profile skills (or none)
        ↓
existing project-local role handoff
        ↓
implementation / independent audit / tests / release gates
```

Typical focused routes are: upload/import → `kafedra-document-intake` + `kafedra-states-and-recovery`; workspace/detail → `kafedra-document-workspace` + `kafedra-provenance-and-inspector`; clutter → `kafedra-action-recomposition`; ambiguity → `kafedra-review-by-exception`; search → `kafedra-search-and-navigation`; responsive inspector → `kafedra-responsive-inspector`; adaptive values → `kafedra-adaptive-controls`; plan/calendar → `kafedra-plan-calendar-continuity`; templates → `kafedra-template-and-structured-document-flow`; motion → `kafedra-motion-continuity`; final document-workspace UX audit → `kafedra-ux-acceptance`.

A backend/infrastructure/release change with no document-workspace or UX concern may route to no focused profile skill after classification. Generic helper names referenced by the upstream snapshot are optional library hints, not Kafedra Planner dependencies. The pinned source, exact blob hashes and governed update procedure are documented in `docs/AI_SKILLS_PROFILE.md`.

## Default handoff

For a non-UI change:

```text
request → flow intake (when needed) → data/design (when needed) → feature delivery → tests → release gate
```

For any GRACE plan whose `ObservedWriteScope` touches `public/**`:

```text
request
  → flow intake (when flow changes)
  → kafedra-design
  → kafedra-motion
  → kafedra-feature
  → kafedra-design-audit
  → kafedra-tests
  → kafedra-release / GRACE final
```

`kafedra-motion` is a mandatory decision point for UI changes but may return `no-motion`; this prevents decorative animation from becoming a default. `kafedra-design-audit` is intentionally after implementation and must inspect the actual result rather than approving its own design brief.

Small internal fixes may skip design intake only when they do not alter user flow, rendered UI, schema, deployment, or a product contract. The feature role still checks that the change does not duplicate an existing entity or projection.

## Design sources of truth

- `docs/design.md` — product hierarchy, Apple-inspired visual/interaction language, responsive/accessibility rules.
- `docs/MOTION_DESIGN.md` — timing, continuity, direct manipulation, materials, reduced-motion and performance policy.
- `docs/design/reactiive-motion-catalog.md` — semantic retrieval index of 123 reference demos; inspiration only, not upstream source redistribution.
- `docs/ADAPTIVE_UX.md` — safe-default/rank-only/domain-derived/never-learn boundary.

When a Reactiive reference is selected, the motion advisor must inspect the current upstream source before presenting exact constants. Source-derived facts and Kafedra recommendations must remain distinguishable.

## UI plan contract

`scripts/design-governance.mjs` runs through `npm run design:check` and as part of `npm run check`. For an active GRACE plan that writes `public/**`, it fails closed unless:

- tasks explicitly include `kafedra-design`, `kafedra-motion`, `kafedra-feature`, `kafedra-design-audit`, and `kafedra-tests` in that order;
- desktop and mobile acceptance is explicit;
- `prefers-reduced-motion` behavior is explicit.

The check validates routing, not aesthetics. The audit role remains responsible for evidence-backed quality decisions.

## Shared definition of done

- The change advances the department-planning workflow, not merely a local screen or table.
- One authoritative domain record remains identifiable; projections, search, calendar, and reports are synchronized safely.
- Offline-first, ACL, provenance, immutable document, audit, transaction, and idempotency invariants hold.
- UI changes preserve obvious primary action, stable geometry, desktop/mobile parity, keyboard/focus behavior and a reduced-motion path.
- Motion explains causality/orientation/feedback and does not delay routine work; static state remains understandable without animation.
- A material UI change has an independent `kafedra-design-audit` PASS before final test/release handoff.
- Relevant unit/integration tests and browser coverage (for UI) pass; `npm run check` and `npm run docs:check` pass when contracts or docs change.
- Migration and release consequences are explicit. A release-impacting change has backup/restore and rollback evidence before promotion.

## GRACE orchestration

GRACE 4 owns the outer lifecycle. A significant request is represented by one approved active `C-*`; the specialist roles above are routed to `T-*` tasks in its approved `GraceChangePlan`.

```text
GraceChangeSpec
      ↓
GraceChangePlan
      ↓
T-* flow-intake (when needed)
      ↓
T-* design
      ↓
T-* motion decision/brief   [UI scope]
      ↓
T-* data (when needed)
      ↓
T-* feature
      ↓
T-* independent design audit [UI scope]
      ↓
T-* tests
      ↓
T-* release
      ↓
GRACE target/final → GitHub required checks → exact-head squash merge
```

Specialist handoffs never widen `ObservedWriteScope`, rewrite approved assertions, push directly to `main`, or replace the selected GRACE final gate with focused tests. Schema work owned by `kafedra-data` must also satisfy the repository migration gate described in `docs/GRACE_GOVERNANCE.md`. Release work owned by `kafedra-release` consumes the successful GRACE/project/release checks; it cannot declare a go decision while any mandatory check is pending, failed, cancelled, missing or unexpectedly skipped.
