# GRACE 4 governance

`kafedra-planner` uses GRACE 4 as the outer engineering lifecycle for significant changes. Project-specific `kafedra-*` Codex skills remain the specialists that design and implement the work; GRACE owns the durable contract, scope, verification and transition between branch stages.

## Invariant

```text
Issue
  → exact main SHA
  → short branch
  → approved GraceChangeSpec
  → approved GraceChangePlan
  → baseline gate before writes
  → scoped implementation
  → selected target/final gate
  → exact-SHA project, release and database gates
  → unchanged-head squash merge
  → post-merge CI
  → C-* applied/archive
```

No step converts a projection into a second source of truth. Application data invariants from `docs/ARCHITECTURE.md` remain authoritative.

## Branch lifecycle

Significant changes require exactly one active `.grace/changes/active/C-*` bundle in the branch diff. Governed surfaces include application/packages/public code, migrations, scripts, tests, deployment/configuration, repository-local Codex skills, project documentation, GitHub workflows and root product/toolchain contracts such as `package*.json`, `README*`, `VERSION`, `.nvmrc`, `.env.example` and `AGENTS.md`. `spec.xml` and `plan.xml` must both be `status="approved"` before implementation writes start.

The durable GRACE model under `.grace/context`, `.grace/graph` and `.grace/verification` is protected by `scripts/github/grace-durable-gate.mjs`: it cannot change without exactly one approved active C-* in the same base-to-head diff. `.grace/changes` has a narrower lifecycle rule. A change without an active bundle may only move one complete `spec.xml`/`plan.xml` pair from `active/C-*` to `archive/C-*`, and both archived roots must be `status="applied"`. Adding or editing an archive bundle directly is rejected.

Before observed writes:

```bash
grace lint --path . --assertions current
grace lint --path . --change C-CHANGE --assertions baseline --run-commands
grace status --path . --json
```

After implementation:

```bash
grace lint --path . --change C-CHANGE --assertions target --run-commands
grace lint --path . --change C-CHANGE --assertions final --run-commands
grace status --path . --json
```

An approved plan is immutable. If scope, assertions or acceptance criteria materially change, supersede the change bundle instead of silently widening an approved plan.

`scripts/grace-governance.mjs policy` compares the branch with its exact base and rejects writes outside `ObservedWriteScope`. The durable companion gate protects GRACE's own context, graph, verification and terminal archive transition. Both are deliberately independent of XML syntax validation, so an agent cannot authorize a broad diff merely by producing well-formed artifacts.

## Role routing

The default task flow inside a `GraceChangePlan` is:

```text
T-* flow intake
  → T-* design + data
  → T-* feature
  → T-* tests
  → T-* release
```

The corresponding repository-local skills are `kafedra-flow-intake`, `kafedra-design`, `kafedra-data`, `kafedra-feature`, `kafedra-tests`, and `kafedra-release`. A specialist may only write files covered by the selected plan's `ObservedWriteScope` and must return evidence to the GRACE controller.

## SQLite and migration gate

Applied SQL files are immutable. A branch may only add the next contiguous `migrations/NNN_lowercase_name.sql`; it may not edit, rename or delete a migration that exists at the comparison base. Any new migration also requires:

- a changed `tests/*migration*.test.mjs` regression test;
- `<M-DATABASE />` in the change spec;
- `<V-M-DATABASE />` in the plan durable verification scope;
- clean database creation from HEAD;
- creation of a real database using the exact base revision, followed by upgrade with HEAD;
- a second HEAD migration run against the already upgraded database to prove idempotency;
- `PRAGMA quick_check` and `PRAGMA foreign_key_check` after every supported state;
- exact `schema_migrations` parity with the migration directory;
- automatic pre-migration backup, backup verification and restoration to the exact base schema whenever a schema migration is added.

Run locally with:

```bash
node scripts/grace-governance.mjs migrations --base origin/main
bash scripts/ci/grace-db-gate.sh origin/main
```

This extends the existing recovery behavior in `scripts/migrate.mjs`; it does not add a second migration engine. Rollback uses the verified pre-migration backup and previous application bundle rather than mutable down-migrations.

## GitHub checks

`.github/workflows/grace.yml` runs on every development-branch push, pull request to `main`, and `main` push. It pins Bun `1.3.14` and `@osovv/grace-cli@4.0.5`. GRACE is not installed into the product runtime or offline bundle.

The workflow deliberately exposes two different aggregate names:

- `GRACE / branch-gate` exists only for a development-branch push and proves branch-local contract/database checks;
- `GRACE / merge-gate` exists only for a pull request or a `main` push. It first requires `GRACE / contract` and `GRACE / database`, then polls the GitHub Checks API for every required check on the exact immutable head SHA.

This separation prevents a successful branch-push check with the same name from satisfying a pull-request protection rule. `scripts/github/grace-merge-gate.mjs` fails closed on a missing, queued, in-progress, failed, cancelled, timed-out, neutral, stale or skipped required check. A successful result from another SHA is ignored.

The single desired-state list lives in `scripts/github/grace-required-checks.mjs` and is shared by the CI aggregator and branch-protection installer:

- `GRACE / merge-gate`
- `Минимальный Node 24.15`
- `test`
- `browser`
- `Сборщик под host Node 25.6`
- `Full offline Debian 12 + Project Control`
- `release-gate`
- `organization-browser`
- `science-lifecycle-browser`
- `science-import-browser`
- `science-reports-browser`

## Server-side protection of main

GitHub branch protection is a server setting and cannot be enforced by repository files alone. Apply the committed desired state once with an administrator token:

```bash
scripts/github/configure-main-protection.sh f2re/kafedra-planner main
```

The script reads the same check list as the exact-SHA merge gate and configures strict up-to-date checks, pull-request-only integration with zero mandatory human approvals, resolved conversations, linear history, squash-only merging, auto-merge support, administrator enforcement, and disables force-push and branch deletion.

Verify afterwards:

```bash
gh api repos/f2re/kafedra-planner/branches/main/protection
```

If a required check is renamed, change the shared list and affected workflow in the same GRACE change. A committed desired-state script is not evidence that the server setting has actually been applied; the API readback is mandatory.

## Merge

A PR is merged only after its exact head SHA is recorded and all mandatory checks are successful. The local helper performs the final stale-head guard:

```bash
scripts/github/merge-grace-pr.sh <PR_NUMBER> f2re/kafedra-planner
```

Agents using GitHub APIs must enforce the same invariant: refetch PR metadata immediately before merge, reject unresolved review threads or non-success checks, and pass the expected head SHA to the squash merge operation.

After merge, fetch the new `main` SHA and confirm post-merge GRACE, project, release, organization and science workflows. Only then is the change considered applied. Move the bundle to `.grace/changes/archive/C-*` with terminal `status="applied"` through a separate archive-only branch and PR; the durable gate accepts only that complete transition, while generic `grace lint` validates the terminal archive state.

## Failure behavior

The governance layer fails closed. It never rewrites an existing migration, force-pushes around a race, widens scope automatically, treats local focused tests as replacement for GitHub CI, accepts a branch-push gate as a PR merge gate, or reports a merge/green gate before GitHub confirms the exact SHA.
