---
name: kafedra-feature
description: Deliver a minimal end-to-end Kafedra Planner feature while preserving its planning, navigation, reporting, evidence, and offline architecture.
---

# Feature delivery

Use this skill to implement or repair a Kafedra Planner feature. Start by reading `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, the relevant domain document, `docs/design.md`, and nearby code/tests. Search the repository for an existing entity, endpoint, projection, and flow before adding any new one.

Implement the smallest complete vertical slice: domain rule and transaction boundary, persistence/API only when necessary, UI that joins the established navigation, understandable errors, tests, and contract documentation when changed. Keep the department workflow coherent: plan items lead to calendar and assignments; assignments lead to evidence, approval, and plan/fact reporting; documents and meetings retain provenance and history.

Do not solve a UI shortcut by duplicating an entity or making a projection authoritative. Preserve immutable source documents, ACL inheritance, auditability, idempotency, and rebuildable search/calendar/report projections. The product must operate without Internet, mandatory LLM, Docker, CDN, or target-machine package installs.

Use `kafedra-flow-intake` and `kafedra-design` for material UX changes; use `kafedra-data` before any persistence change; use `kafedra-tests` for coverage. If deployment, schema version, VERSION, package artifacts, backup/restore, or systemd changes, involve `kafedra-release` before describing the work as ready.
