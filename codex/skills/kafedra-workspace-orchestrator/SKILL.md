---
name: kafedra-workspace-orchestrator
description: Routes Kafedra Planner and document-workspace UI/UX tasks across intake, provenance, action recomposition, review-by-exception, responsive inspector, motion, recovery and acceptance while preserving project-local authority.
---

# Kafedra Workspace Orchestrator

Use this skill when a task crosses several Kafedra/document-workspace concerns. For a local one-control fix, use the focused skill directly.

## Authority gate

If the target is an established repository, inspect its instructions/design/skills first. Inside `f2re/kafedra-planner`, repository-local `AGENTS.md`, GRACE contracts, `docs/design.md`, `docs/UX_FLOWS.md`, `docs/ADAPTIVE_UX.md`, `docs/MOTION_DESIGN.md` and local `codex/skills/kafedra-*` outrank this reusable profile.

Do not install or rewrite project-local roles merely to register this library. Use project-first integration and semantic merge.

## Task classification

Classify the task before loading skills:

- new/material workflow → flow/intent + affected domain skills;
- primary work-surface/IA change → `anti-slop-ui-direction` concept gate first;
- existing clutter/click tax → Interaction Recomposition + `kafedra-action-recomposition`;
- upload/import/processing → `kafedra-document-intake` + states/review/provenance;
- document/list/detail → workspace + provenance + responsive inspector;
- ambiguity/review → review-by-exception + provenance;
- search/navigation → search + workspace/provenance;
- adaptive defaults → `kafedra-adaptive-controls`;
- motion/gesture → `kafedra-motion-continuity` and shared motion/gesture skills;
- final verification → `kafedra-ux-acceptance`.

Do not load meteorological domain skills for document work.

## Two primary design lanes

### Lane A — new or materially changed flow

1. State actor, operational job, trigger, authoritative object, permission boundary and proof of completion.
2. Search the target project for an existing object/flow before inventing a parallel one.
3. If the primary surface/IA is changing, run the Anti-Slop concept gate.
4. Select the minimum Kafedra domain skills.
5. Decide motion/no-motion.
6. Hand observable acceptance to implementation/tests.
7. Run independent acceptance after implementation.

### Lane B — existing UI simplification

1. Map the frequent user intent.
2. Run shared Interaction Recomposition over the whole control cluster.
3. Use `kafedra-action-recomposition` to remove backend decomposition, derived selectors and confirmation tax without hiding independent domain semantics.
4. Preserve source/state/actions and stable geometry.
5. Audit the implemented path.

Do not escalate Lane B into a macro redesign unless the work surface itself is wrong.

## Kafedra invariants to preserve

- immutable source and version/evidence path;
- safe deterministic automation before manual confirmation;
- one bad row/file does not block unrelated data;
- manual correction does not destroy extracted evidence;
- task completion is a direct domain transition; evidence files are optional by default;
- projections navigate to source-of-truth rather than become independent editors;
- repeated operations are idempotent;
- archive/restore preserves history;
- core flow works offline and without LLM;
- adaptive behavior never moves interface geometry or overrides saved/domain-derived values.

## Delegation

Use specialists only for bounded work:

- `document-workspace-designer` — document/list/inspector/intake/search design;
- `ui-methodology-director` — macro concept only;
- `motion-interaction-reviewer` — material motion/direct manipulation only;
- `ui-ux-auditor` + `kafedra-ux-acceptance` — independent implemented-result audit.

Inside Kafedra Planner prefer the repository-local specialist lifecycle rather than spawning library agents over it.

## Output contract

Synthesize one coherent decision, not concatenated reports. Record:

- primary user job and authoritative object;
- selected route/skills and why;
- primary action and secondary disclosure;
- source/provenance behavior;
- async/partial/error/recovery behavior;
- desktop/mobile mapping;
- adaptive-control classification where relevant;
- motion/no-motion decision;
- observable acceptance criteria.

## Patterns

- Project-local authority first.
- Work-object-first routing.
- Review by exception.
- Interaction Recomposition before widget replacement.
- Motion as a separate decision, allowed to return `no-motion`.
- Independent post-implementation audit.

## Anti-patterns

- Loading every Kafedra skill because the task mentions documents.
- Treating a generic dashboard as the default work surface.
- Replacing project-local `kafedra-*` skills with library agents.
- Adding confirmation/approval stages to make automation “safer” when data is already reversible/editable.
- Letting motion redefine data semantics or lifecycle.
- Letting a search/report/calendar projection become a second editable truth.
