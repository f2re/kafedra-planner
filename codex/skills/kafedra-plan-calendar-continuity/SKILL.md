---
name: kafedra-plan-calendar-continuity
description: Designs Kafedra Planner transitions between plan source rows, plan items, assignments, calendar projections and Plan/Fact so users keep origin and completion context while projections never become separate sources of truth.
---

# Kafedra Plan / Calendar Continuity

Use when a workflow crosses annual plans, plan items, assignments, calendar or Plan/Fact.

## Source-of-truth chain

Model the visible relationship explicitly:

```text
source document/version/row
  → plan item
  → optional assignment
  → calendar projection
  → plan/fact projection
```

A manual plan/item starts from a manual authoritative record rather than inventing a fake file source.

## Calendar role

Calendar is the time-oriented projection and default attention surface. It should expose origin and navigate to the authoritative plan item/assignment when edits affect business state.

Do not duplicate the plan item into an independently editable calendar record.

## Plan item execution modes

Preserve semantics such as:

- tracked checkpoint/event;
- assigned task;
- open/self-claimable task.

Do not collapse them into one status dropdown merely to simplify UI. Recompose controls around the user's intent while preserving domain distinctions.

## Completion continuity

When an assignment completes, the UI should reflect the synchronized result across linked plan item, calendar and Plan/Fact without making the user manually update each projection.

A short local transition may explain the change, but persisted domain truth determines final state.

## Source-row editing

One source row may materialize into several plan items. Keep source-row provenance accessible from each resulting item. Splitting/editing is a working transformation; it must not erase the original row/cells.

## Exact automatic assignment

A unique exact domain match may be shown as a derived assignment. Ambiguous/missing matches remain unresolved raw values; the interface must not imply a guess was confirmed.

## Navigation

Use readable links such as `Из плана кафедры`, `Открыть пункт`, `Открыть задачу`, `В календаре`. Preserve return context (selected plan, period, day or filters).

## Patterns

- Explicit source → work object → projection chain.
- Automatic synchronized completion.
- Readable origin links across plan/calendar/task.
- Source rows remain evidence after splitting/materialization.
- Exact domain-derived match vs visible ambiguity.
- Calendar edits route through authoritative domain operation.

## Anti-patterns

- Requiring the user to mark task, plan item and calendar entry complete separately.
- Independently editable calendar copies of plan items.
- Losing source row/cell provenance after splitting.
- Guessing an assignee because a similar name is common.
- Treating Plan/Fact projection as the place where source obligations are rewritten.
- Hiding origin because the calendar looks cleaner without it.
