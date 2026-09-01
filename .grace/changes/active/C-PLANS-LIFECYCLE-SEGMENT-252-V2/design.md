# Design contract — C-PLANS-LIFECYCLE-SEGMENT-252-V2

## Product decision

The earlier planning-only change treated mobile as a separate acceptance mode. The product owner removed that scope on 1 September 2026. This change therefore defines one shared web control and does not introduce mobile navigation, a mobile list/detail state machine, a bottom sheet, swipe gestures or mobile-specific animation.

The existing responsive layout remains in place. Narrowing a desktop window may reflow the same control, but it does not create another interaction mode.

## Entry point and goal

The user opens **Планы** to answer one primary navigation question: show plans that are currently in work or plans already in the archive. This lifecycle view must be visible without opening a filter menu.

## Visible hierarchy

1. Page title and existing plan actions.
2. Persistent `Текущие | Архив` segmented control.
3. Existing search and ordinary filters.
4. Plan list and existing detail panel.

The lifecycle control is not an ordinary filter and is not placed inside the filter grid. It does not archive or restore a plan; it only changes the server-backed register view.

## Interaction

- `Текущие` maps to the existing `active` status.
- `Архив` maps to the existing `archived` status.
- Click, Enter, Space, Left/Right, Home and End select a mode.
- The selected tab uses `aria-selected=true` and `tabindex=0`; the other tab uses `aria-selected=false` and `tabindex=-1`.
- The existing `#plans-lifecycle-status` select remains only as a hidden compatibility bridge. It is not visible, focusable or announced as a second control.
- The adapter changes the bridge value and emits its existing `change` event. It does not call the API or filter a combined result set itself.
- Search and ordinary filters keep their values.
- When the previous selected plan is absent, the existing plan loader clears stale detail and selects the first available plan deterministically.

## States

- Loading keeps the control and current selected mode visible.
- Empty current view: `Текущих планов по этим условиям нет.`
- Empty archive view: `Архивных планов по этим условиям нет.`
- A mode switch must not leave the previous plan detail visible after an empty response.
- Repeated selection of the already active mode is a no-op and must not create an additional state source.
- Archive and restore operations that update the hidden bridge remain reflected in the visible segment.

## Visual contract

- Stable order: `Текущие`, then `Архив`.
- Minimum effective height: 44 CSS pixels.
- Selection is expressed through text, surface/border treatment and accessibility state; colour is supplementary.
- Visible focus must remain clear on selected and unselected tabs.
- The segment fits in the existing plans toolbar at 1440×900 and in a narrowed 900×700 desktop window without page-level horizontal scrolling.
- Geometry, order and default are `never-learn`.

## Accessibility

The segment is a `tablist` with two `tab` elements. Keyboard navigation follows the horizontal visual order and moves focus together with selection. Status meaning remains understandable in a static frame and with colour removed.

## Out of scope

No separate mobile mode, mobile navigation, bottom sheet, mobile-only test matrix, filter popover, card/detail redesign, source-row decision, archive/restore command, API or SQLite change is included.
