# Kafedra AI skills profile

Kafedra Planner хранит собственную проверяемую копию document-workspace profile из `f2re/ai-agents-skills`. Профиль используется только как development guidance для агентов и не входит в runtime/offline bundle приложения.

## Зафиксированный источник

- repository: `f2re/ai-agents-skills`;
- commit: `2645ab8afd34963e80397981d582ea3b141db8e3`;
- upstream path: `.agents/skills/`;
- local manifest: `codex/skills/kafedra-profile.json`;
- local orchestrator: `codex/skills/kafedra-workspace-orchestrator/SKILL.md`.

Каждый vendored `SKILL.md` должен быть byte-identical соответствующему upstream Git blob. `scripts/ai-skills-profile-check.mjs` вычисляет Git blob SHA локального файла и сравнивает его одновременно с manifest и встроенным expected set.

| Skill | Git blob SHA |
|---|---|
| `kafedra-workspace-orchestrator` | `aa5cdff00e6b518df57a45aff5e578a10b931f9c` |
| `kafedra-document-workspace` | `0c853c4d9a0abd5c54fea7953a301d59a3aaa5f8` |
| `kafedra-document-intake` | `2fd3199d55e5803c330586e8f47a488337cb8494` |
| `kafedra-provenance-and-inspector` | `2a2818bb5c2c1be7e14b7c1096a8b5c3d405e011` |
| `kafedra-action-recomposition` | `caa94c7bea4b7fbceb0f384edc33c2f8a3dce3df` |
| `kafedra-review-by-exception` | `8d47f6eda68e57484159105af0050943361cb4b4` |
| `kafedra-search-and-navigation` | `a0f5cb3303342308a619065698dc89264f6ff116` |
| `kafedra-responsive-inspector` | `8b863d0ba32ca9230567ed3ca451bd5d75ed816e` |
| `kafedra-motion-continuity` | `cb350ffe7e5dec02ac397a9a1d3d5981a45d6d5b` |
| `kafedra-states-and-recovery` | `fc0f83ed13999614d634e6c1d0602fb5099fb9b0` |
| `kafedra-adaptive-controls` | `9eeb78dc1149608db649a5040d2c7708563ae6f1` |
| `kafedra-plan-calendar-continuity` | `5c5aa08c0090455902722a1e9aef1c3377a5018c` |
| `kafedra-template-and-structured-document-flow` | `249828096577508af9f8aa1ca489d2a35fde3e4e` |
| `kafedra-ux-acceptance` | `eeead5bbf0fde9eeb4d2829761bd72418324850d` |

## Authority and automatic routing

The profile does not create a second agent hierarchy. Authority is always:

```text
AGENTS.md
→ approved GRACE change
→ project architecture/domain/UX contracts
→ repository-local kafedra-* specialist role
→ orchestrator-selected focused profile skill
```

After repository and GRACE preflight every substantial change reads `kafedra-workspace-orchestrator`. It selects only the focused skills relevant to the request. Pure backend, infrastructure or release work may explicitly select no focused profile skill after classification.

The existing project roles remain owners of their scopes. `kafedra-flow-intake` owns flow acceptance; `kafedra-design` owns design; `kafedra-motion` owns motion/no-motion; `kafedra-data` owns persisted truth/migrations; `kafedra-feature` owns implementation; `kafedra-design-audit` owns independent UI verdict; `kafedra-tests` owns executable regression coverage; `kafedra-release` owns release/offline/rollback gates.

References in the upstream snapshot to generic shared library helpers such as `anti-slop-ui-direction` or `dense-controls-and-selection` are optional hints. Kafedra Planner does not require those helpers to be installed and never fetches them at runtime. Project-local roles provide the required fallback authority.

## Fail-closed verification

`npm run check` invokes `scripts/ai-skills-profile-check.mjs`. The validator fails when:

- source repository/commit/base path differs from the pinned values;
- the set of 14 skills changes unexpectedly;
- a skill path, upstream path or manifest blob SHA changes;
- local bytes do not hash to the expected Git blob SHA;
- a skill frontmatter name does not match its directory;
- mandatory AGENTS/CODEX preflight markers disappear;
- a repository-local specialist loses its `Kafedra profile handoff` marker;
- this provenance document or the `npm run check` integration disappears.

Focused regression coverage lives in `tests/ai-skills-profile.test.mjs`.

## Updating the snapshot

Profile updates are never pulled automatically. To update:

1. inspect current `main`, open an Issue and create a new governed GRACE change;
2. choose and record one exact upstream commit;
3. review upstream changes and confirm they do not conflict with project-local authority or invariants;
4. replace only the selected vendored `SKILL.md` files with exact upstream bytes;
5. update `codex/skills/kafedra-profile.json`, this document and the validator's expected commit/blob set in the same governed change;
6. keep project-local handoffs semantic rather than copying upstream authority rules into them;
7. run the profile validator, focused tests, `npm run check`, `npm run docs:check`, full project CI, GRACE target/final and release/offline/database gates;
8. merge only through exact-head squash PR, verify post-merge CI, then perform the separate GRACE archive-only terminal transition.

No update may add a runtime network dependency, mandatory LLM, Docker, CDN, target-machine package installation or automatic upstream fetch merely to use these skills.
