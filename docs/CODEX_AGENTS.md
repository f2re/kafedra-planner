# Codex project roles

These roles are implemented as repository-local skills in `codex/skills/`. Invoke the named role for focused work, or use the handoff sequence below for a feature that crosses layers. Roles advise or implement only within the user’s authorization; release and production actions always require explicit confirmation.

| Role / skill | Owns | Produces | Must involve next |
|---|---|---|---|
| Flow intake & UX acceptance / `kafedra-flow-intake` | Problem framing, navigation fit, UX acceptance | A short accept / revise / reject decision with evidence and risks | Designer before UI work; feature delivery after acceptance |
| Product designer / `kafedra-design` | Interaction design, information hierarchy, responsive states | Flow specification and UI acceptance criteria | Data steward if a new fact or state is implied; test engineer before handoff |
| Data steward / `kafedra-data` | Entity ownership, schema, migrations, data invariants | Schema decision, migration plan, verification/rollback impact | Feature delivery and test engineer |
| Test engineer / `kafedra-tests` | Risk-based unit, integration, browser, and release regression coverage | Executable test plan and test changes | Feature delivery for gaps; release operator for release-surface changes |
| Feature delivery / `kafedra-feature` | Minimal end-to-end implementation and integration | Working vertical slice with docs and focused verification | All relevant specialist roles before merge |
| Release operator / `kafedra-release` | Versioning, artifact, migration rollout, backup/restore, deployment and rollback gates | Go / no-go evidence and an operator runbook delta | Test engineer and data steward before a release-impacting merge |

## Default handoff

```text
request → flow intake → design + data (when needed) → feature delivery → tests → release gate
```

Small internal fixes may skip design intake only when they do not alter user flow, schema, deployment, or a product contract. The feature role still checks that the change does not duplicate an existing entity or projection.

## Shared definition of done

- The change advances the department-planning workflow, not merely a local screen or table.
- One authoritative domain record remains identifiable; projections, search, calendar, and reports are synchronized safely.
- Offline-first, ACL, provenance, immutable document, audit, transaction, and idempotency invariants hold.
- Relevant unit/integration tests and browser coverage (for UI) pass; `npm run check` and `npm run docs:check` pass when contracts or docs change.
- Migration and release consequences are explicit. A release-impacting change has backup/restore and rollback evidence before promotion.
