# Release evidence — v0.4.3 draft finalization

## Attempt 1

Exact attempted main: `75eb52302c0cdaaa3515247785d2351c18ca348b`.

GitHub Actions run `33955505976` was started by fast-forwarding `release-run` to that exact current `main` SHA. The single `Release` workflow completed these release-critical stages successfully:

- `release-preflight` exact-main check;
- `release-verify` project check, unit/integration, smoke and backup self-test;
- `release-browser-critical`, including annual protocol import, meetings, release readiness, PIN and ACL;
- internal `release-gate`;
- one full Debian 12 offline bundle build;
- checksum and internal manifest verification;
- systemd clean install, repeated update, legacy update, lock rejection and rollback self-test on the same archive;
- Project Control package creation from that verified archive;
- canonical SHA-256 verification;
- exact-main check immediately before publication;
- draft GitHub Release creation and upload of seven non-empty verified assets.

The final job failed only while reading the still-draft release through `GET /releases/tags/v0.4.3`, which returns HTTP 404 for an unpublished draft. Draft release id `383186617` remained unpublished with `tag_name=v0.4.3`, `target_commitish=75eb52302c0cdaaa3515247785d2351c18ca348b`, and seven uploaded assets. No `refs/tags/v0.4.3` existed.

## Attempt 2

After PR #314 the exact main became `418287dd88406e1f1489fa01ea24de6fdd75257c`. Release run `33956139668` again passed preflight, project verification, critical browser/PIN/ACL, internal gate, build-once full bundle, systemd clean install/update/rollback, Project Control, checksums and the exact-main check immediately before publication.

The stale draft from attempt 1 was deleted successfully. A new draft was then created successfully with:

- release id `383189702`;
- `tag_name=v0.4.3`;
- `target_commitish=418287dd88406e1f1489fa01ea24de6fdd75257c`;
- `draft=true`.

The run failed before asset upload because it tried to rediscover the just-created draft through the releases collection immediately after `gh release create`. The authenticated API showed the draft afterwards, proving an eventual-visibility race in collection discovery rather than a problem with exact SHA or draft metadata. No public `refs/tags/v0.4.3` was created.

## Current fix

The build, verification and deployment path remains unchanged. Draft creation is changed to the GitHub Releases REST create endpoint itself. Its synchronous response already contains `id`, `tag_name`, `target_commitish` and `draft`, so no collection rediscovery is required.

The workflow now:

1. deletes only failed unpublished drafts for the current tag after exact-main preflight;
2. creates the new draft by `POST /releases` with `target_commitish=$SOURCE_SHA` and captures `RELEASE_ID` directly from that response;
3. verifies the returned draft tag and exact target SHA immediately;
4. uploads the same seven verified assets;
5. re-reads and verifies the draft by `GET /releases/{RELEASE_ID}`;
6. publishes by `PATCH /releases/{RELEASE_ID}`;
7. verifies the resulting public release and final tag ref against the exact source SHA.

This remains within `C-RELEASE-CONNECTOR-TRIGGER-306`. It introduces no second workflow, polling, redispatch, sleep loop, version-specific automation or duplicate project/browser/deployment verification.
