# Design contract — C-PLANS-LIFECYCLE-SEGMENT-252

## Hierarchy

`Текущие | Архив` is the permanent primary mode control of the plans register. It appears at the start of the plans filter area, before search and secondary filters. It never moves into a dropdown or overflow menu.

The existing `#plans-lifecycle-status` select remains only as a hidden compatibility bridge for the current lifecycle module. It is removed from visual layout, tab order and the accessibility tree, so the user sees and operates exactly one lifecycle control.

## Interaction

- One click, tap, Enter or Space activates the chosen mode.
- Left/Up and Right/Down arrows move between the two modes and activate the result.
- Home activates `Текущие`; End activates `Архив`.
- A mode change dispatches the legacy select’s existing `change` event. The adapter does not call `/api/plans` or locally filter a combined set.
- Search and existing ordinary filters remain untouched.
- The existing plans loader keeps a selected plan only if it exists in the returned set; otherwise it selects the first available plan or renders no detail.
- Archive/restore operations can still set the compatibility select; the visible segment synchronizes from it.

## Visual contract

- Fixed order: `Текущие`, then `Архив`.
- Stable geometry independent of result count or usage statistics.
- Selected state combines label, filled segment surface, shape and `aria-selected`; color is supplementary.
- Minimum interactive height is 44 px.
- Visible focus works on selected and unselected segments.
- Desktop uses a compact intrinsic-width control. At 720 px and below the control stretches to the available filterbar width without horizontal page overflow.
- Current no-result text becomes `Текущих планов по этим условиям нет.`
- Archive no-result text becomes `Архивных планов по этим условиям нет.`

## Adaptive classification

Lifecycle mode is `never-learn`. Usage frequency cannot select its value, reorder the tabs, change geometry or promote archive over current. Plan `status` remains a persisted domain fact and is never changed by viewing a register.

## Out of scope

Secondary-filter disclosure, plan cards/detail, archive impact, source-row decisions, evidence, API and SQLite.
