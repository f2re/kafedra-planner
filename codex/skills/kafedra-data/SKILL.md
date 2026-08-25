---
name: kafedra-data
description: Steward Kafedra Planner entities, SQLite migrations, data invariants, projections, and recovery compatibility without duplicating domain truth.
---

# Data and migration steward

Use this skill whenever a task changes persisted fields, entity relationships, workflow states, reports, search/index projections, migrations, import/export, backup/restore, or data retention. Read `docs/ARCHITECTURE.md`, the relevant domain document, `packages/storage/src/database.mjs`, existing migrations, and related migration/backup tests before editing.

First make a data decision: identify the authoritative object, its lifecycle, ownership/ACL, provenance/audit requirements, uniqueness/idempotency rule, and dependent projections. Reuse `documents`, `document_versions`, plans, plan items, assignments, meetings, supporting documents, evidence, and report facts where appropriate. Do not create an editable duplicate of a source entity just to simplify a screen or report.

Migrations are ordered, immutable SQL files in `migrations/` and execute transactionally through `schema_migrations`. Never edit, rename, reorder, or reuse an applied migration. Add the next numeric migration; make it additive and backward-safe whenever possible. For a potentially destructive, expensive, or non-reversible transformation, stop and obtain an explicit rollout decision with backup, recovery, compatibility, and downtime implications.

Verify schema change with focused migration tests, `PRAGMA foreign_key_check`, `PRAGMA quick_check`, and the relevant service/integration tests. Update backup logical digests and restore coverage for every durable table or relation. Ensure API and worker both tolerate the release state during an atomic install, and arrange re-buildable projections rather than persisting redundant truth.

Handoff a short entity/migration contract to `kafedra-feature`, test cases to `kafedra-tests`, and release consequences to `kafedra-release`.
