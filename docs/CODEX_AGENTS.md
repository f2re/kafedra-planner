# Codex project roles

Repository-local roles live in `codex/skills/`. They are specialists, not mandatory ceremony. The task is first classified by repository rules and `kafedra-workspace-orchestrator`; then only the roles that own a real risk or contract are involved.

| Role / skill | Owns | Typical evidence |
|---|---|---|
| `kafedra-flow-intake` | User flow, navigation fit, acceptance | Short accept/revise decision for a materially changed flow |
| `kafedra-design` | Interaction hierarchy, responsive behavior, usability | UI acceptance criteria for material interface work |
| `kafedra-motion` | Motion, gestures, continuity, reduced motion | Motion brief or explicit `no-motion` when motion is actually relevant |
| `kafedra-design-audit` | Independent implemented UI audit | PASS / REVISE / BLOCK on the actual result |
| `kafedra-data` | Storage, schema, migrations, recovery | Data invariants, migration/recovery evidence |
| `kafedra-feature` | End-to-end implementation | Working vertical slice and focused verification |
| `kafedra-tests` | Unit/integration/browser regression | Targeted executable evidence |
| `kafedra-release` | CI, installer, update, offline, rollback, release | Go/no-go evidence for deployment/release risk |

## Kafedra profile preflight

Every substantial change reads `codex/skills/kafedra-workspace-orchestrator/SKILL.md`. The orchestrator is a classifier, not a second authority. It chooses the minimum relevant skills from the pinned profile; project-local `AGENTS.md`, architecture, GRACE and domain contracts remain authoritative.

```text
repository preflight
      ↓
classify actual risk / user flow
      ↓
select only necessary roles and focused skills
      ↓
implementation → targeted evidence → integration audit
```

A backend/infrastructure/release task may legitimately return `focused profile skills: none`. A local UI fix may need only `kafedra-feature` and `kafedra-tests`; a material UX redesign normally needs `kafedra-design` and independent `kafedra-design-audit`; `kafedra-motion` is added only when motion, gestures or transitions are materially affected. Schema/recovery work routes to `kafedra-data`; CI/release work routes to `kafedra-release`.

Typical document-workspace routes remain available: intake → `kafedra-document-intake`; ambiguity → `kafedra-review-by-exception`; search → `kafedra-search-and-navigation`; responsive inspector → `kafedra-responsive-inspector`; adaptive defaults → `kafedra-adaptive-controls`; plan/calendar → `kafedra-plan-calendar-continuity`; templates → `kafedra-template-and-structured-document-flow`; final material UX audit → `kafedra-ux-acceptance`.

The pinned source and governed update procedure are documented in `docs/AI_SKILLS_PROFILE.md`.

## Handoff rule

There is no universal role pipeline. Handoff follows ownership of the changed contract:

```text
problem
  → domain owner(s) needed for this change
  → implementation
  → independent audit when the change warrants one
  → targeted tests
  → release gate only when deployment/release is affected
```

The repository **не требует фиксированного порядка ролей** merely because a file under `public/**` changed. A static text/style fix must not be inflated into design → motion → feature → audit → tests. Conversely, a material change to navigation, responsive geometry, gestures or accessibility must involve the specialist that owns that risk.

One contract has one primary executor. Parallel specialists own bounded scopes; the integrator checks interactions after their work. Roles never widen `ObservedWriteScope`, alter approved acceptance criteria or create a second source of truth.

## Design sources of truth

- `docs/design.md` — product hierarchy, interaction and responsive/accessibility principles;
- `docs/MOTION_DESIGN.md` — causality, continuity, direct manipulation, `no-motion`, reduced motion and performance;
- `docs/design/reactiive-motion-catalog.md` — semantic reference index; its usefulness is not defined by an exact number of rows;
- `docs/ADAPTIVE_UX.md` — `safe-default`, `rank-only`, `domain-derived`, `never-learn` boundaries.

`scripts/design-governance.mjs` checks these durable contracts. It deliberately does not validate a style slogan, an exact catalog count or GRACE task choreography. It still fails closed if a required design source disappears, the motion safety contract loses `prefers-reduced-motion`/`no-motion`, or the reference catalog becomes unusable or loses its redistribution boundary.

When a reference is used, upstream source-derived facts and project recommendations remain distinguishable. The catalog is inspiration and navigation, not vendored source code.

## UI acceptance

For UI work, verify what actually changed:

- obvious primary action and stable geometry;
- keyboard/focus behavior;
- only the affected desktop/mobile layout, or both when both changed;
- `prefers-reduced-motion` when motion/transition/gesture changed;
- source/provenance and authoritative-object boundaries when the UI edits domain data.

A material UI change should receive independent implemented-result audit. A local non-material fix does not need a fabricated audit stage merely to satisfy governance.

## Shared definition of done

- The change solves the user or operational problem end to end.
- One authoritative domain record remains identifiable; projections do not become competing editors.
- Offline-first, ACL, provenance, immutable source, audit, transaction and idempotency invariants hold where applicable.
- Error/partial-success/recovery behavior is explicit.
- Relevant targeted regression passes.
- `npm run check`, documentation validation, project tests and smoke pass on the PR head.
- Schema/storage/security/deployment/release risks receive their specific heavier gate; ordinary changes do not.

## GRACE and CI

GRACE is the outer lifecycle only for governed risk: schema/storage/recovery, immutable evidence/history, auth/security, installer/update/rollback, CI/release infrastructure or other dangerous architectural changes. Ordinary UI/API/test/docs work does not require GRACE just because a role exists.

A governed change has one approved active `C-*`, scoped implementation and exact-head GRACE lint/scope plus the relevant risk gate. GRACE does not rerun project unit/browser tests already proved by CI and does not poll other workflows.

The ordinary PR workflow `Проверка` supplies the complete project evidence. After squash merge, `main` gets only a short post-merge smoke rather than a second full project suite. Release remains a separate explicit version-neutral workflow from exact `main`, builds the offline artifact once and verifies install/update/forced rollback before publication.
