---
name: kafedra-release
description: Prepare and assess Kafedra Planner releases, migrations, offline deployment, updates, backups, and rollback using the existing atomic release contract.
---

# Release and deployment operator

Use this skill for versioning, release readiness, offline bundles, deployment, upgrades, migrations, backups, rollback, systemd, or production promotion. Read `docs/RELEASE_CANDIDATE.md`, `docs/VALIDATION.md`, `docs/OFFLINE_INSTALL.md`, `docs/BACKUP_RESTORE.md`, `docs/TARGET_ACCEPTANCE.md`, `docs/PROJECT_CONTROL.md`, and the installer scripts before acting.

The release flow is fixed:

```text
verified source + green required CI
→ version/manifest and compatible bundle
→ target preflight and additive-only package guard
→ verified pre-update backup
→ immutable staged release and atomic current switch
→ ordered migrations
→ API/worker/systemd health and doctor
→ accept, or restore backup and previous release automatically
```

Never replace this with manual SQLite edits, symlink manipulation, `apt --fix-broken`, upgrades/downgrades/removals of target packages, or a deployment tool that bypasses the native installer. The application bundle may carry dependencies for a clean supported target; an existing target receives only missing packages under `full-airgap-v2 / additive-only-v2`.

Before promotion, obtain: verified `main` and PR head, mergeability/review resolution, every required GitHub job completed successfully, migration/data-steward sign-off, backup/restore evidence, relevant browser and deployment tests, artifact hashes/manifests, and target compatibility. Do not call incomplete, cancelled, failed, or unexpectedly skipped CI green.

For a migration rollout, require forward compatibility or an explicitly approved maintenance plan, a tested upgrade from the supported prior schema, a verified encrypted backup, `quick_check`/foreign-key evidence, blob and logical-digest preservation, a forced-failure rollback test, and post-install health. Stable promotion also requires the real Astra/Debian acceptance evidence in `docs/TARGET_ACCEPTANCE.md`; CI alone is insufficient.

Production deployment and release publication are external side effects: stop before them unless the user explicitly authorizes the exact target. Report a concise go/no-go decision, evidence, operator command source, rollback trigger, and unresolved risk.

Kafedra profile handoff: after `kafedra-workspace-orchestrator` preflight, treat the vendored profile strictly as development guidance. `kafedra-states-and-recovery` may refine operator-visible offline/retry semantics when relevant, but the profile must never become a runtime, network, LLM, package or target-machine dependency. This project-local release role and the existing release/offline/database gates remain authoritative.
