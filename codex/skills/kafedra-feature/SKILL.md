---
name: kafedra-feature
description: Deliver a minimal end-to-end Kafedra Planner feature while preserving its planning, navigation, reporting, evidence, and offline architecture.
---

# Feature delivery

Use this skill to implement or repair a Kafedra Planner feature. Start by reading `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, the relevant domain document, `docs/design.md`, and nearby code/tests. Search the repository for an existing entity, endpoint, projection, and flow before adding any new one.

Implement the smallest complete vertical slice: domain rule and transaction boundary, persistence/API only when necessary, UI that joins the established navigation, understandable errors, tests, and contract documentation when changed. Keep the department workflow coherent: plan items lead to calendar and assignments; assignments complete directly and may have optional evidence; completion updates plan/fact without a mandatory approval stage; documents and meetings retain provenance and history.

Do not solve a UI shortcut by duplicating an entity or making a projection authoritative. Do not add a confirmation, report, review, return, or manager action when the system can safely apply the result immediately and leave it editable. Preserve immutable source documents, ACL inheritance, auditability, idempotency, and rebuildable search/calendar/report projections. The product must operate without Internet, mandatory LLM, Docker, CDN, or target-machine package installs.

Use `kafedra-flow-intake` and `kafedra-design` for material UX changes; use `kafedra-data` before any persistence change; use `kafedra-tests` for coverage. If deployment, schema version, VERSION, package artifacts, backup/restore, or systemd changes, involve `kafedra-release` before describing the work as ready.

Kafedra profile handoff: after the mandatory `kafedra-workspace-orchestrator` preflight, consume only the focused profile skills selected for this vertical slice. For document/workspace implementation this commonly includes `kafedra-states-and-recovery`, `kafedra-provenance-and-inspector`, `kafedra-plan-calendar-continuity` or `kafedra-template-and-structured-document-flow`; do not load the entire profile by default. Repository-local role decisions and the approved GRACE plan remain authoritative.
