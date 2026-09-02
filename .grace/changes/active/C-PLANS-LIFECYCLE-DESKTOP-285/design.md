# Design contract — C-PLANS-LIFECYCLE-DESKTOP-285

## User path

`Планы → Текущие | Архив → one action → matching server-side list`.

The control is a persistent two-option segmented control in the desktop filter toolbar. It represents a top-level lifecycle view, not an ordinary filter and not an archive/restore command.

## Interaction

- Fixed order: `Текущие`, then `Архив`.
- Pointer click and native Enter/Space activate a segment.
- Left/Right and Up/Down move and activate; Home selects `Текущие`, End selects `Архив`.
- Search and ordinary filters remain unchanged.
- If the selected plan is absent in the new list, the existing plans controller selects the first available plan or renders its existing empty detail.
- The hidden select remains the single compatibility bridge to the existing lifecycle controller.

## Desktop boundary

The segmented control exists only for `(min-width: 721px)`. Below the breakpoint it is removed and the original select is restored. No mobile-only layout, navigation, sheet, gesture or transition is introduced.

## Visual/accessibility contract

- `role=tablist` and `role=tab` with `aria-selected` and roving tabindex.
- Selected state uses text, shape and elevation; color is supplementary.
- Each target is at least 44 px high and wide.
- Focus remains visible for selected and unselected segments.
- Empty states are `Текущих планов нет`, `Архив пуст`, or `Планов по этим условиям нет.` when other filters are active.
- Loading and errors are never overwritten by an empty-state decorator.

Lifecycle view is `never-learn`; geometry, order and value are stable.
