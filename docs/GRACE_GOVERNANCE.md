# GRACE 4 governance

`kafedra-planner` uses GRACE 4 as the outer engineering lifecycle for significant changes. Project-specific `kafedra-*` Codex skills remain the specialists that design and implement the work; GRACE owns the durable contract, scope, verification and transition between branch stages.

## Invariant

```text
Issue
  → exact main SHA
  → short branch
  → draft/approved GraceChangeSpec
  → approved GraceChangePlan
  → baseline gate before governed writes
  → scoped implementation
  → selected final gate
  → project CI + release gate + database gate
  → unchanged-head squash merge
  → post-merge CI
  → immutable archive-only PR
  → C-* applied/archive
```

No step converts a projection into a second source of truth. Application data invariants from `docs/ARCHITECTURE.md` remain authoritative.

## Branch lifecycle

A development branch is compared with the exact current `main` base. Branch pushes may advance through three machine-visible stages:

| Stage | Allowed branch state | GRACE assertion gate |
| --- | --- | --- |
| `draft` | one active `C-*`; draft or approved spec; plan optional/draft | `current` |
| `planned` | approved spec and approved plan; no governed implementation writes yet | `baseline --run-commands` |
| `implementation` | approved spec/plan plus governed writes contained by `ObservedWriteScope` | `final --run-commands` |

A pull request to `main` cannot contain only an active proposal. It must contain a completed governed change with approved `spec.xml` and `plan.xml`, or be the dedicated terminal archive-only transition described below.

Until terminal archiving, the sole complete active `C-*` remains the governing contract for corrective follow-up branches based on that `main`; it may be continued without rewriting the approved bundle, but a different active change cannot coexist with it or borrow its scope.

Every repository file is governed except direct XML artifacts inside `.grace/changes/active/C-*` and `.grace/changes/archive/C-*`, which are validated by dedicated lifecycle rules. Consequently, application code, tests, scripts, workflow files, root build/test configuration, documentation, and durable GRACE context/graph/verification artifacts all require exactly one matching active `C-*`. This closes the possibility of changing architectural contracts or weakening a test configuration outside a change plan.

Before governed writes:

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

`scripts/github/grace-policy-gate.mjs` independently compares the branch with its exact base and rejects writes outside `ObservedWriteScope`. It is deliberately separate from GRACE CLI so an agent cannot make a broad diff merely by keeping XML syntactically valid.

## Terminal archive transition

GRACE 4 keeps an executable change under `.grace/changes/active/` while selected final assertions are being evaluated. Therefore the completed bundle is archived only after the implementation PR is merged and the new `main` SHA has green post-merge CI.

Archiving is a second, dedicated archive-only branch and PR. The policy accepts it only when all of the following are true:

- the exact base contains one approved active bundle;
- HEAD removes that active bundle and creates the same `C-*` under `archive`;
- no application, documentation, workflow, context, graph, verification or other repository file changes;
- the exact bundle file set is preserved;
- every companion artifact is byte-identical;
- `spec.xml` and `plan.xml` differ only in their root `status`;
- both roots use the same terminal status: `applied`, `rejected`, `cancelled` or `superseded`;
- no active copy remains at HEAD.

A direct edit of an existing archive, a content rewrite disguised as archiving, deletion without an archive, or archive plus product changes fails closed. The archive PR runs normal PR CI and is squash-merged with the same exact-head rule.

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
- `PRAGMA quick_check` and `PRAGMA foreign_key_check` after each supported state;
- exact `schema_migrations` parity with the migration directory;
- automatic pre-migration backup, backup verification and restoration to the exact base schema whenever a schema migration is added.

Run locally with:

```bash
node scripts/grace-governance.mjs migrations --base origin/main
bash scripts/ci/grace-db-gate.sh origin/main
```

This extends the existing recovery behavior in `scripts/migrate.mjs`; it does not add a second migration engine. Database rollback is restoration of the verified pre-migration backup; destructive down-migrations are not introduced.

## GitHub checks

`.github/workflows/grace.yml` runs on every development-branch push, pull request to `main`, and `main` push. It pins Bun `1.3.14` and `@osovv/grace-cli@4.0.5`. GRACE is not installed into the product runtime or offline bundle.

Check names are event-specific so a branch push and its pull-request run cannot publish ambiguous duplicate contexts:

| Event | Contract/database/aggregate names |
| --- | --- |
| pull request | `GRACE / contract`, `GRACE / database`, `GRACE / merge-gate` |
| development branch push | `GRACE branch / contract`, `GRACE branch / database`, `GRACE branch / merge-gate` |
| `main` push | `GRACE post-merge / contract`, `GRACE post-merge / database`, `GRACE post-merge / merge-gate` |

`GRACE / merge-gate` is successful only if both PR-scoped GRACE jobs complete successfully. Existing project CI, release CI, organization and science workflows remain independent mandatory evidence.

The desired required checks for `main` are:

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

A required check that is pending, failed, cancelled, missing or unexpectedly skipped is not merge evidence. Conditional assertion modes are executed inside one check step, so lifecycle selection does not create misleading skipped check jobs.

## Server-side protection of main

GitHub branch protection is a server setting and cannot be enforced by repository files alone. Apply the committed desired state once with an administrator token:

```bash
scripts/github/configure-main-protection.sh f2re/kafedra-planner main
```

The script configures strict up-to-date checks, pull-request-only integration with zero mandatory human approvals, resolved conversations, linear history, squash-only merging, auto-merge support, administrator enforcement, and disables force-push and branch deletion.

Verify afterwards:

```bash
gh api repos/f2re/kafedra-planner/branches/main/protection
```

If a required check is renamed, change the workflow and protection desired state in the same GRACE change.

## Merge

A PR is merged only after its exact head SHA is recorded and all mandatory checks are successful. The local helper performs the final stale-head guard:

```bash
scripts/github/merge-grace-pr.sh <PR_NUMBER> f2re/kafedra-planner
```

Agents using GitHub APIs must enforce the same invariant: refetch PR metadata immediately before merge, reject unresolved review threads or non-success checks, and pass the expected head SHA to the squash merge operation.

After implementation merge, fetch the new `main` SHA and confirm post-merge CI. Then create the archive-only PR described above, let all PR checks complete, and squash-merge it with exact-head verification. Only the second merge leaves the durable GRACE state with zero active changes and one terminal archived bundle.

## Failure behavior

The governance layer fails closed. It never rewrites an existing migration, force-pushes around a race, widens scope automatically, treats local focused tests as replacement for GitHub CI, modifies durable GRACE contracts without an active plan, rewrites an archive, or reports a merge/green gate before GitHub confirms it.
