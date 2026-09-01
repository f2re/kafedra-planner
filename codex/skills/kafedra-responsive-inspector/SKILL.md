---
name: kafedra-responsive-inspector
description: Maps Kafedra Planner master-detail document workflows across desktop and mobile without changing domain semantics, hiding critical actions or compressing dense tables into unusable layouts.
---

# Kafedra Responsive Inspector

Use when adapting Kafedra document/list/detail flows across supported desktop and mobile widths.

## Same workflow, different density

Desktop/mobile must preserve the same:

- authoritative object;
- permission boundary;
- current state;
- primary domain action;
- source/evidence access;
- recovery path;
- saved values.

Responsive design changes composition, not business meaning.

## Desktop default

Prefer stable side navigation plus a scannable list/table and simultaneous inspector when width permits. The selected row remains visibly selected. Filters stay attached to the list they affect.

Avoid making every detail a modal; preserve spatial context for repeated document/task work.

## Tablet/narrow desktop

When three columns no longer fit, collapse secondary navigation or inspector deliberately. Keep the user's object/list context and use a predictable detail pane/sheet rather than shrinking all columns to illegibility.

## Mobile default

- fixed primary navigation appropriate to the product;
- list → full detail or sheet with a clear Back/close path;
- secondary table columns become labelled fields/sections;
- primary action remains reachable without hover;
- source/history stay available through disclosure;
- transient sheets preserve form input on recoverable error.

## Tables

Do not force normal mobile work into horizontal scrolling if a labelled stacked representation is practical. Keep only scan-critical fields in the compact row and move secondary metadata into detail.

## Inspector sections

Prioritize on small screens:

1. identity + state;
2. next action;
3. responsibility/timing;
4. source/provenance;
5. optional metadata/history.

Do not push the only completion/recovery action below large decorative headers.

## Touch and keyboard

Targets should normally provide at least a 44×44 CSS-pixel effective area where layout allows. Desktop remains fully keyboard usable; mobile gestures may accelerate navigation but cannot be the only path for consequential actions.

## State continuity

When navigating list → detail → back, restore useful list/query/filter/scroll context. Orientation motion may help, but reduced-motion must remain complete.

## Patterns

- Three-pane desktop when useful; deliberate two/one-pane collapse.
- Semantic table-to-detail transformation.
- Same primary action and provenance across widths.
- Context-preserving Back.
- Stable primary navigation.
- Touch-sized targets and visible focus/keyboard path.

## Anti-patterns

- Hiding source/history/completion on mobile.
- Desktop table simply squeezed until text becomes unreadable.
- Hover-only actions required for common work.
- Different lifecycle/permissions between responsive layouts.
- Bottom sheets for every desktop interaction regardless of task frequency/context.
- Mobile gesture as the only archive/complete/restore path.
- Responsive reordering that changes the meaning or priority of fields/actions.
