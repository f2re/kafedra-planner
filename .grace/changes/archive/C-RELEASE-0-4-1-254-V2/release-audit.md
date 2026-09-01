# Release audit — Kafedra Planner 0.4.1

## Decision

**PASS for pull-request CI.** Tagging and GitHub Release publication remain prohibited until the release PR is squash-merged and the resulting exact `main` commit completes post-merge CI.

## Release base

The candidate branch was created from `main` only after:

- the document-runtime reliability change completed implementation merge, post-merge checks and terminal archive;
- the desktop plans lifecycle change completed implementation merge, post-merge checks and terminal archive;
- no active GRACE bundle remained on `main`;
- no open product pull request remained targeted at `main`;
- the accidental probe path was absent;
- historical, draft, unmerged and mobile-specific branches were excluded.

## Version consistency

Verified on the candidate tree:

- `VERSION` = `0.4.1`;
- `package.json.version` = `0.4.1`;
- `package-lock.json.version` = `0.4.1`;
- `package-lock.json.packages[""].version` = `0.4.1`;
- README identifies the current version as `0.4.1`;
- ROADMAP identifies `0.4.1` as the current release milestone;
- `docs/RELEASE_0.4.1.md` exists and describes only merged behavior;
- the temporary updater workflow is absent from the final tree.

## Scope integrity

The candidate does not change:

- SQLite schema or any applied migration;
- document bytes, SHA-256, version or evidence authority;
- package installation, backup, migration, rollback or service architecture;
- dependencies or lockfile package graph, apart from the root project version;
- mobile navigation, mobile list/detail modes, bottom sheets, gestures or mobile-only transitions;
- Docker, CDN, cloud or mandatory LLM requirements.

## Local exact-head evidence

The following commands completed successfully on one unchanged candidate checkout:

```text
node --test tests/release-version.test.mjs
npm run check
npm run docs:check
npm test
npm run release:gate
bash -n scripts/offline/*.sh deploy/*.sh
grace lint --path . --change C-RELEASE-0-4-1-254-V2 --assertions target --run-commands
grace lint --path . --change C-RELEASE-0-4-1-254-V2 --assertions final --run-commands
```

The release diff was also checked to contain no migration, temporary updater workflow, connector probe or test-only production bypass.

## Required GitHub evidence before merge

Every mandatory exact-head check must be successful, including GRACE merge-gate, supported Node tests, browser tests, host builder, full offline Debian 12 + Project Control, release gate, organization browser and science lifecycle/import/report browser jobs. Pending, failed, cancelled, missing or unexpectedly skipped checks are blockers.

## Required publication evidence

After squash merge:

1. obtain the new exact SHA of `main`;
2. confirm complete post-merge CI on that SHA;
3. create tag `v0.4.1` at that exact commit;
4. publish a non-draft, non-prerelease GitHub Release with Russian notes;
5. verify artifact names, embedded version and SHA-256;
6. perform a separate archive-only transition to terminal `applied`.
