---
name: kafedra-action-recomposition
description: Recombines Kafedra Planner document/plan/task control clusters around one domain intent, removing confirmation tax, derived selectors and duplicated toolbars while preserving independent semantics and consequential actions.
---

# Kafedra Action Recomposition

Use after shared `dense-controls-and-selection` identifies a cluster that serves one frequent intent.

## Start with the domain verb

Write the frequent job as a verb phrase:

- upload a plan;
- complete an assignment;
- attach supporting material;
- archive a document;
- change the plan period;
- resolve an ambiguous responsible person;
- open the source.

Then list every current control involved. Classify each as:

- essential independent input;
- derived/context metadata;
- rare override;
- secondary navigation;
- redundant confirmation;
- technical implementation detail.

## Recomposition rules

1. Keep independent business choices explicit.
2. Derive values the system already knows from selected object/day/source/organization.
3. Move rare overrides into predictable contextual disclosure.
4. Remove `Apply/Confirm` when a reversible selection/action can safely persist immediately.
5. Give one primary domain action a stable home.
6. Avoid duplicated top toolbar + row actions + inspector actions unless each serves a distinct context.
7. Preserve keyboard operation and visible text for consequential actions.

## Examples

### Assignment

Bad:

`Status [▼] Progress [▼] [Save] [Submit] [Attach report] [Request approval]`

Preferred default contract:

`Выполнено` as primary action; progress/comment/material are optional secondary edits; no approval step unless domain rules explicitly require one.

### Document metadata

Bad:

`Kind [▼] Parser [▼] OCR [▼] Language [▼] [Apply]`

Preferred:

show detected operator-level kind and processing state; allow `Уточнить вид` contextually; parser/OCR engine remain diagnostics/configuration unless the operator must decide.

### Calendar create

Selected day is domain-derived. Do not present an old learned date as an equal default that can silently override the clicked day.

### Plan row review

Put source excerpt + candidate + correction action together. Do not require navigating between source modal, assignment modal and final confirmation modal.

## Consequential actions

Archive, restore, completion, return-to-work, ACL/role and destructive-like operations are not adaptive shortcuts. Their placement is stable and consequences are explicit. Confirmation is justified when consequence is non-obvious or difficult to reverse, not as a universal ritual.

## Bulk actions

Bulk mode appears only after explicit selection. Keep selection count and scope visible. Do not replace the normal row interaction with permanently visible bulk controls.

## Patterns

- One intent → one control cluster.
- One stable primary domain action.
- Derived metadata shown as context, not selector.
- Contextual rare overrides.
- Immediate reversible persistence where safe.
- Explicit bulk scope after selection.

## Anti-patterns

- One-for-one cosmetic replacement of five dropdowns with five prettier dropdowns.
- `Save`/`Apply` after every harmless selector.
- Exposing parser/database/internal status decomposition as operator choices.
- Hiding truly independent choices merely to reduce widget count.
- Repeating the same actions in page header, every row and inspector without context rationale.
- Making optional evidence or approval part of the completion control cluster.
- Moving frequently used actions based on usage statistics.
