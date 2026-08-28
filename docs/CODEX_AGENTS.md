# Codex project roles

These roles are implemented as repository-local skills in `codex/skills/`. Invoke the named role for focused work, or use the handoff sequence below for a feature that crosses layers. Roles advise or implement only within the user’s authorization; release and production actions always require explicit confirmation.

GRACE 4 is the outer change controller. The `kafedra-*` roles do not replace `GraceChangeSpec`, `GraceChangePlan`, scopes or assertions: they execute specialist tasks inside one approved plan. The normative lifecycle is documented in `docs/GRACE_WORKFLOW.md`.

| Role / skill | Owns | Produces | Must involve next |
|---|---|---|---|
| Flow intake & UX acceptance / `kafedra-flow-intake` | Problem framing, navigation fit, UX acceptance | A short accept / revise / reject decision with evidence and risks for the C-* spec | Designer before UI work; feature delivery after acceptance |
| Product designer / `kafedra-design` | Interaction design, information hierarchy, responsive states | Flow specification and UI acceptance criteria within approved scope | Data steward if a new fact or state is implied; test engineer before handoff |
| Data steward / `kafedra-data` | Entity ownership, schema, migrations, data invariants | Schema decision, migration plan, verification/rollback impact | Feature delivery and test engineer |
| Test engineer / `kafedra-tests` | Risk-based unit, integration, browser, and release regression coverage | Executable test plan and verification entries | Feature delivery for gaps; release operator for release-surface changes |
| Feature delivery / `kafedra-feature` | Minimal end-to-end implementation and integration | Working vertical slice constrained by one or more T-* tasks | All relevant specialist roles before final GRACE evidence |
| Release operator / `kafedra-release` | Versioning, artifact, migration rollout, backup/restore, deployment and rollback gates | Go / no-go evidence and an operator runbook delta | Test engineer and data steward before an applied archive |

## GRACE-controlled handoff

```text
request / Issue
  → grace-spec + kafedra-flow-intake
  → kafedra-design + kafedra-data when applicable
  → grace-plan
  → grace-execute
      ├─ kafedra-feature
      ├─ kafedra-tests
      └─ kafedra-release
  → target/final assertions
  → applied archive
  → PR / GRACE merge gate
```

A role worker receives an immutable T-* task, its acceptance criteria, relevant M-*/DF-* graph context, V-M-* verification and an explicit `ObservedWriteScope`. It must stop on scope conflict, hidden dependency, stale base or a requirement that changes the approved plan. The controller either replans through a new C-* or continues with the next dependency-ready task.

Small internal fixes may skip design intake only when they do not alter user flow, schema, deployment, or a product contract. A documentation-only typo can also skip C-* when `scripts/grace-policy.mjs` classifies the diff as non-significant. The feature role still checks that the change does not duplicate an existing entity or projection.

## Data and migration handoff

Any persisted entity, SQL migration, projection ownership, import provenance, recovery or deletion/lifecycle change must involve `kafedra-data`. A migration-impacting plan must include:

- append-only sequential migration files;
- a migration/schema/database regression test;
- `npm run grace:migrations`;
- `npm run backup:selftest`;
- `PRAGMA quick_check` and `PRAGMA foreign_key_check` evidence;
- an explicit rollback procedure based on backup restore and previous bundle.

The release role cannot promote a schema change merely because fresh-install tests pass: base-to-head upgrade and repeated migration must also pass.

## Shared definition of done

- The change advances the department-planning workflow, not merely a local screen or table.
- One authoritative domain record remains identifiable; projections, search, calendar, and reports are synchronized safely.
- Offline-first, ACL, provenance, immutable document, audit, transaction, and idempotency invariants hold.
- Relevant unit/integration tests and browser coverage (for UI) pass; `npm run check` and `npm run docs:check` pass when contracts or docs change.
- GRACE graph/verification stay current, all changed files are covered by approved scope, and final evidence is fresh for the exact SHA.
- Migration and release consequences are explicit. A release-impacting change has backup/restore and rollback evidence before promotion.
- The final PR head contains an `applied` archive bundle and `GRACE merge gate` succeeds before squash merge.
