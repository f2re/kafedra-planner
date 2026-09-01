---
name: kafedra-document-workspace
description: Designs Kafedra Planner document/plan/assignment work surfaces around authoritative objects, calm master-detail hierarchy, visible next actions and source-connected context instead of generic dashboards.
---

# Kafedra Document Workspace

Use for the primary organization of Documents, Plans, Assignments, Meetings, Review and adjacent operational surfaces.

## Start from the work object

Before layout, name:

- authoritative object;
- current state;
- owner/responsibility;
- time relevance;
- origin/source;
- next meaningful domain action.

The primary surface must make these facts faster to understand than technical configuration.

## Default desktop composition

Prefer a stable structure:

```text
primary navigation | operational list/table | inspector/detail
```

The list is for scanning and selection. The inspector is the object's normal home for detail, editing, source, history and contextual actions. Avoid a second full editor for the same object.

Use one dominant surface, not nested cards. Group with headings, typography, spacing and separators before adding containers.

## Scanning hierarchy

Rows/cards used for operational scanning should normally expose only what drives a decision:

1. identity/title/number;
2. due/event date or relevant period;
3. responsible person/status;
4. compact origin/provenance;
5. exception/risk marker when action is actually required.

Technical IDs, hashes, parser details and full audit metadata belong in disclosure/inspector unless troubleshooting is the user goal.

## Attention vs analytics

A summary may exist, but it must answer an operational question such as `требует внимания`, `срок сегодня`, `неоднозначность`, not merely decorate the page with totals.

Do not force users through metric cards before they can reach the objects behind the metrics.

## Object continuity

Opening an object from calendar, search, plan, assignment or review should land in the same authoritative detail pattern. Preserve enough return context to go back to the source list/query/day.

## Empty states

State why there are no objects and offer the smallest relevant action:

- `Документов пока нет` → `Загрузить`;
- `Нет вопросов для проверки` → no artificial task;
- filtered empty → show active filters + `Сбросить`.

Never invent sample business data in production empty states.

## Labels

Prefer concrete Russian domain language. Do not leak internal codes (`unknown`, `faculty_plan`, `submitted`) when an operator label exists. Consequential actions need text, not icon-only ambiguity.

## Patterns

- Calendar/attention as time-oriented entry, list/detail as object-oriented work.
- One object, one normal inspector/detail home.
- Compact provenance in scan view, exact evidence in detail.
- Filters next to the results they affect.
- Stable primary navigation and action placement.
- Calm density over decorative whitespace or card grids.

## Anti-patterns

- Generic KPI dashboard as mandatory landing surface.
- Cards inside cards for every field group.
- Separate “search viewer”, “calendar editor” and “report editor” for the same object.
- Primary actions buried under overflow while technical metadata dominates.
- Full-width configuration forms used as the default work surface.
- Icon-only archive/complete/restore actions.
- Usage frequency moving primary navigation or actions.
