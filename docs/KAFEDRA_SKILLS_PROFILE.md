# Kafedra skills profile

Kafedra Planner vendors a narrow document-workspace profile from `f2re/ai-agents-skills` so the same interaction and evidence rules are available offline to future development agents. This is development governance, not an application runtime dependency.

## Pinned source

- Upstream repository: `f2re/ai-agents-skills`.
- Upstream commit: `2645ab8afd34963e80397981d582ea3b141db8e3`.
- Upstream base path: `.agents/skills/`.
- Machine-readable provenance: `codex/skills/kafedra-profile.manifest.json`.
- Integrity command: `npm run skills:check`.

Only the fourteen Kafedra-specific `SKILL.md` files listed in the manifest are vendored. Meteorological skills, generic framework skills, installers and external agent registrations are not pulled into this project automatically. References to such library helpers inside an upstream skill are optional methodology hints unless Kafedra Planner separately adopts them through a governed change.

## Authority order

The profile never creates a second development lifecycle. Resolve conflicts in this order:

```text
AGENTS.md and explicit user authorization
→ approved GRACE change contract
→ Kafedra Planner architecture/domain/design/release documentation
→ existing repository-local kafedra specialist role
→ selected reusable Kafedra profile skill
```

`kafedra-workspace-orchestrator` is therefore a routing preflight, not a replacement architect. It classifies the user job and selects the minimum relevant profile skills. Existing roles remain responsible for flow intake, data, design, motion, implementation, independent design audit, tests and release.

## Vendored skills

| Skill | Focus |
|---|---|
| `kafedra-workspace-orchestrator` | Classify substantial document/workspace work and select the smallest useful route. |
| `kafedra-document-workspace` | Authoritative-object list/detail/inspector organization. |
| `kafedra-document-intake` | Source-first upload/import, automatic safe materialization and partial success. |
| `kafedra-provenance-and-inspector` | Immutable source/evidence, corrections, history and projection navigation. |
| `kafedra-action-recomposition` | Reduce control fragmentation and confirmation tax without losing domain choices. |
| `kafedra-review-by-exception` | Human review only for real ambiguity, with source context. |
| `kafedra-search-and-navigation` | Search as context-preserving navigation to authoritative objects. |
| `kafedra-responsive-inspector` | Same workflow and source access across desktop/mobile density changes. |
| `kafedra-motion-continuity` | Restrained motion/no-motion decisions for continuity and local feedback. |
| `kafedra-states-and-recovery` | Local async/error/partial/offline states and idempotent targeted retry. |
| `kafedra-adaptive-controls` | Stable safe-default/rank-only/domain-derived/never-learn behavior. |
| `kafedra-plan-calendar-continuity` | Source → plan item → assignment → calendar → plan/fact continuity. |
| `kafedra-template-and-structured-document-flow` | Versioned templates, anchors, preview and generated-document flow. |
| `kafedra-ux-acceptance` | Evidence-backed post-implementation acceptance for document-workspace changes. |

## Routing rule

For substantial development, start with `codex/skills/kafedra-workspace-orchestrator/SKILL.md`, then load only the profile skills applicable to the task. A storage-only fix does not need the workspace UI profile; a document import flow usually needs intake, states/recovery and provenance; a plan/calendar flow adds plan-calendar continuity; adaptive or motion work uses its dedicated skill. The selected profile guidance is handed into the normal project roles described in `docs/CODEX_AGENTS.md`.

## Safe update procedure

The profile is intentionally not synchronized from the network at runtime or during ordinary builds. Updating it requires a separate reviewed change:

1. Create a GitHub Issue and a new approved GRACE `C-*` from the current exact `main`.
2. Select and record one exact upstream commit; do not track a moving branch.
3. Inspect the upstream diff and the Git blob SHA of every Kafedra profile skill. Do not import unrelated skills or installers by default.
4. Replace only approved local snapshot files and update `codex/skills/kafedra-profile.manifest.json` with the exact source paths and blob SHAs.
5. Review project routing separately. Upstream text does not automatically gain authority over `AGENTS.md`, GRACE or repository-local roles.
6. Run `npm run skills:check`, `node --test tests/kafedra-skills-governance.test.mjs`, `npm run check`, `npm run docs:check` and the selected GRACE target/final gates.
7. Require the normal exact-head project, release, offline and database CI, squash merge, post-merge CI and terminal archive-only transition.

Never auto-pull a newer profile merely because upstream `main` changed. A pinned snapshot stays valid until a deliberate governed update replaces it.
