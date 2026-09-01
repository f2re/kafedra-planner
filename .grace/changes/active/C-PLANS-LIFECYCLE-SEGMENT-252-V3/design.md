# Design contract — C-PLANS-LIFECYCLE-SEGMENT-252-V3

## Product decision

The product owner explicitly removed separate mobile modes from this iteration. The implementation therefore creates one shared web control and does not add mobile list/detail navigation, bottom sheets, swipe gestures, mobile-only actions, breakpoints that change interaction semantics or a mobile state machine.

Repository-wide responsive tests may still run as regressions. They do not define a second product mode and cannot change the control’s order, value or behavior.

## User goal

The user opens **Планы** and must immediately answer one navigation question: show plans currently in work or plans already in the archive. Lifecycle is therefore a persistent register view, not a secondary filter hidden in a select.

## Hierarchy

1. Existing page title and plan actions.
2. Persistent `Текущие | Архив` segment.
3. Existing search and ordinary filters.
4. Plan list and existing detail panel.

The segment is inserted before the filter grid. The original lifecycle select remains only as a hidden compatibility bridge for the established lifecycle controller.

## Interaction

- `Текущие` maps to the existing `active` server status.
- `Архив` maps to the existing `archived` server status.
- Click, Enter and Space activate the focused tab.
- Left/Right wrap between the two tabs; Home/End select the first/last tab.
- The selected tab is the only tab in the tab order.
- Changing mode dispatches the existing select `change` event; the adapter does not call the API and does not filter a combined client-side list.
- Search and ordinary filters retain their values.
- The existing plans loader remains authoritative for clearing an absent selected plan and selecting the first available result.

## States

- Loading leaves the selected lifecycle state visible.
- Empty active result: `Текущих планов по этим условиям нет.`
- Empty archived result: `Архивных планов по этим условиям нет.`
- Empty results never keep a stale previous-plan detail.
- Selecting the current mode again is a no-op.
- Archive and restore operations remain synchronized because the visible control reads the compatibility select after the existing lifecycle refresh.

## Visual contract

- Fixed order: `Текущие`, then `Архив`.
- Minimum tab height: 44 CSS pixels.
- Selection uses label, surface, border, shadow and `aria-selected`; color is supplementary.
- Focus remains visible for both selected and unselected tabs.
- Primary acceptance geometry: desktop `1440×900` and narrowed desktop `900×700`.
- No breakpoint changes the control into a dropdown, sheet or separate mobile interaction.
- Lifecycle view is `never-learn`; usage cannot choose, reorder or relocate it.

## Accessibility

The group uses `role="tablist"` and each action uses `role="tab"`, `aria-selected`, `aria-controls` and roving `tabindex`. Static selected/unselected states carry the complete meaning. The hidden select is removed from visual and accessibility navigation to prevent duplicate controls.

## Non-goals

No API, SQLite, archive/restore command, filter popover, plan card/detail, source-row decision or mobile-specific mode is changed.
