---
name: kafedra-tests
description: Plan and implement risk-based Kafedra Planner unit, integration, browser, migration, and release regression tests.
---

# Test engineer

Use this skill for a feature, regression, test strategy, coverage review, or release validation. Read the relevant implementation and closest existing tests first; use `package.json` to select supported commands. Do not add snapshots or tests that only assert wording when an observable domain or UX invariant can be tested.

Create coverage along the changed boundary: domain/service behaviour, API and persistence integration, migration upgrade/backup/restore where data changes, and Playwright desktop/mobile coverage where user interaction changes. Include idempotent retries, authorization/provenance boundaries, error preservation, and programmatic-default-not-a-user-choice tests when applicable.

For UI, assert the actual workflow: correct initial state, an understandable primary path, durable saved result, and recovery from meaningful failure. For reports and projections, assert their source record and synchronization rather than only the rendered count. For deployment changes, extend the existing offline, package-policy, systemd, update/rollback, and bundle tests instead of introducing a separate harness.

Run the narrowest meaningful tests during iteration, then the relevant documented suite. Report commands run, results, remaining unrun release gates, and any missing acceptance criterion. Hand off release-surface risk to `kafedra-release`; do not waive a required CI gate.

Kafedra profile handoff: after `kafedra-workspace-orchestrator` preflight, use `kafedra-ux-acceptance` as the document/workspace acceptance checklist and add focused assertions from `kafedra-states-and-recovery` and `kafedra-provenance-and-inspector` when retry, partial success, evidence or projection-source integrity is material. This augments, never replaces, executable project tests and required CI gates.
