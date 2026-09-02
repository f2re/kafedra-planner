---
name: kafedra-search-and-navigation
description: Designs Kafedra Planner search, facets and cross-object navigation so users can find documents/plans/tasks by operator language, keep filter context and land in the authoritative normal detail surface.
---

# Kafedra Search and Navigation

Use for global/section search, facets, document numbering/date lookup, assignee/source filters and navigation across linked objects.

## Search goal

Search is primarily a **navigation accelerator to real objects**, not a separate document viewer or reporting database.

## Result anatomy

A result row should expose enough to disambiguate:

- readable object type;
- title/number/name;
- relevant date/period;
- state/assignee when useful;
- compact origin/source;
- matching excerpt only when it helps explain the hit.

Do not lead with internal IDs or raw FTS scoring.

## Query and facets

Keep section filters near results. Active filters are visible and individually reversible. Neutral/saved values are not silently replaced by learned preferences.

Common useful facets may include object type, period, source, direction, assignee, active/archive state and attention status. Do not expose every database field as a facet.

## Keyboard path

Frequent desktop search should support:

- focus search from a predictable shortcut/control;
- arrow navigation through results where appropriate;
- Enter/open;
- Escape/clear or close transient search without losing the underlying page unexpectedly.

Keyboard acceleration supplements normal visible controls.

## Opening a result

Open the result in its normal authoritative detail/inspector pattern. Preserve the query, filters, scroll and selection so Back returns to the same search context.

## Linked navigation

From an object, source/evidence/assignment/plan/calendar links should be semantic and readable. Avoid browser-like link mazes of IDs.

## Empty/no-match state

Explain whether there are truly no records or filters removed all matches. Offer `Сбросить фильтры` when that is the likely recovery.

## Archive

Search may include archived objects through an explicit active/archive scope. Archived origin/history remains readable and does not silently redirect to a successor.

## Patterns

- Search as object navigation.
- Operator-language result rows.
- Visible reversible facets.
- Context-preserving Back.
- Exact origin drill-down from normal detail.
- Keyboard acceleration without hiding pointer/touch path.

## Anti-patterns

- Separate search result editor that can diverge from the object.
- Dozens of permanent filter controls above a small list.
- Raw internal codes/IDs as primary result labels.
- Opening a result destroys query/filter/scroll context.
- Learned filters silently replace explicit neutral or saved scope.
- Archived item automatically redirects to successor and hides original history.
