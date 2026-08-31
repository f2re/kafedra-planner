# Design contract — C-PLANS-LIFECYCLE-SEGMENT-245-V2

## Hierarchy

`Текущие | Архив` is a persistent two-option segmented control in the plans toolbar. It represents the list’s primary lifecycle mode and is visually separated from search and general filtering. It is not placed inside an overflow menu or dropdown.

## Interaction

- One click, tap, Enter or Space changes the lifecycle view.
- The control delegates to the existing lifecycle select and query semantics; it never archives or restores an object itself.
- Search text remains unchanged across the switch.
- A selected plan remains selected only when present in the new result set; otherwise the existing controller selects the first available plan or renders its empty state.
- The source select remains the single state authority but is removed from the visible and accessibility interaction surface after enhancement.
- A rerendered source select is detected and enhanced again without duplicate controls.

## Visual contract

- Fixed order: `Текущие`, then `Архив`.
- Stable width and position independent of usage statistics or result count.
- Selected state uses label, segment shape and `aria-selected`; color is supplementary.
- Minimum interactive height and hit area: 44 px.
- Focus ring is visible against selected and unselected states.
- On mobile the segment may occupy the toolbar width but never becomes a dropdown.

## Adaptive classification

Lifecycle view is `never-learn`: frequency cannot choose its value, reorder segments or change their position. The saved lifecycle of a plan remains a domain fact and is not modified by viewing a list.

## Empty state

The segment remains available when either result set is empty. No stale detail from the previous mode is retained by this enhancement; list and detail fallback remain the existing plans controller’s responsibility.

## Out of scope

General filter popover, plan-card redesign, source-row workflow, archive/restore commands and API/storage changes.
