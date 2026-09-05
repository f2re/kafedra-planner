# Release evidence — v0.4.3 draft finalization

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

The fix keeps the existing build and verification path unchanged. It:

1. removes any unpublished failed draft for the current tag after exact-main preflight, so a retry cannot accidentally publish an artifact built for an older main;
2. captures the newly created draft `RELEASE_ID` from the authenticated releases collection using both tag and exact `target_commitish`;
3. verifies draft state, exact source SHA and all seven assets through `GET /releases/{RELEASE_ID}`;
4. publishes only after those checks, then verifies the public release and tag ref against the exact source SHA.

This is release-infrastructure recovery within the existing `C-RELEASE-CONNECTOR-TRIGGER-306` scope. It adds no second workflow, polling, redispatch, sleep loop or version-specific automation.
