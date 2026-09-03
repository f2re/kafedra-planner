# Delegation evidence — C-DOCOMATOR-UPDATE-0-4-2-303

## Orchestration boundary

The lead integrator owns the exact-main branch, GRACE contract, cross-scope integration, GitHub writes, release decision and final regression audit. Responsibility packets are sequenced so that no two roles write the same contract concurrently.

## Responsibility packets

- **kafedra-flow-intake** — map the complete administrator journey and recoverable states; output is incorporated in `design.md` and `docs/UX_FLOWS.md`.
- **kafedra-design** — own hierarchy, labels, desktop/mobile geometry, accessibility and stable adaptive-control classification in `design.md`, `public/docomator-integration.js` and its CSS.
- **kafedra-motion** — own the explicit no-motion decision in `motion.md`; no runtime animation dependency or visual delay is allowed.
- **kafedra-data** — own URL normalization, legacy persisted settings compatibility, current Docomator readiness contract, per-row isolation and idempotent links in `packages/integrations/src/docomator.mjs` and integration tests. SQLite schema and migrations are out of scope.
- **kafedra-feature** — own the vertical server route → browser form → source preview → import path after design and data contracts are fixed.
- **kafedra-release** — own cache revalidation, private archive staging, installed-code/data ownership boundaries, active-release verification, documentation, version synchronization and immutable assets.
- **kafedra-design-audit** — review the implemented UI only after feature and updater work; findings are recorded in `design-audit.md` before the tests stage.
- **kafedra-tests** — own unit, integration, Playwright desktop/mobile, deployment/rollback and regression evidence after the independent design audit.

## Baseline evidence

- Exact base `main`: `dfd86da67c789cfc1b9410d3afb6501425a7845d`.
- Governing issue: `#303`.
- Approved-plan head: `e79161ec5a6f2924ea0086d14c8c2a0cc2b077b1`.
- GRACE branch `contract`, `database` and `merge-gate` checks completed successfully before governed writes.
- Baseline release is `0.4.1`; SQLite schema is `31`; no migration is planned.

## Integration audit and corrective packets

- **kafedra-feature**: the Docomator settings card and admin API read are now mounted only after the authoritative auth context is ready and only for an authenticated administrator; staff and manager sessions retain their personal contours without admin-only Docomator requests. Auth-disabled local mode remains supported.
- **kafedra-release**: `install-from-archive.sh` no longer replaces the launcher process with `exec`; its EXIT trap removes private `/tmp/kafedra-install.*` staging after both success and failure while leaving the user-owned source directory untouched.
- **kafedra-tests**: the mobile auth regression was isolated from the product change. The previous helper selected by a stale option index while rank-only preferences could reorder native options. The corrected test selects the stable person value, then still verifies explicit choice persistence, subordinate scope and admin denial. No auth/ACL production contract is changed.
- **lead integration audit**: Docomator repository main was checked against the implemented `/healthz`, `/readyz`, access unlock, spaces, groups, members, employees and property-definition endpoints. The release branch uses the actual service contract and keeps classified DNS/refused/timeout/TLS/protocol failures non-blocking for local work.

Final exact-head CI, release publication and immutable terminal archive evidence will be recorded through GitHub checks, Release API and the archive-only PR before issue #303 closes.
