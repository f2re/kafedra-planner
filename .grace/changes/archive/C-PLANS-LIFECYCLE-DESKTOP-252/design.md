# Design contract — C-PLANS-LIFECYCLE-DESKTOP-252

## Entry and goal

The operator opens **Планы** on a workstation and immediately sees the primary register mode: `Текущие | Архив`. The control is permanently visible near the result it changes and is visually separate from ordinary search/filter inputs.

## Interaction

- One click, Enter, Space or horizontal arrow action selects the mode.
- The visible segment delegates to the existing `#plans-lifecycle-status` select and its established `status=active|archived` request path.
- The source select remains only as an inaccessible compatibility bridge; it is not a second visible source of truth.
- Search and ordinary filter values are not changed.
- The existing plans controller remains responsible for list replacement and clearing/replacing a selected plan absent from the new result.
- Archive/restore actions continue to update the same source select and therefore synchronize the segment.

## States

- selected current: `Текущие`, `aria-selected=true`;
- selected archive: `Архив`, `aria-selected=true`;
- loading: existing list context remains; the segment does not fabricate progress;
- current empty without secondary conditions: `Текущих планов нет`;
- archive empty without secondary conditions: `Архив пуст`;
- filtered empty: the existing `Планов по этим условиям нет` remains;
- error: existing plans error handling remains authoritative and local input is preserved.

## Visual hierarchy

- Two equal-width segments with fixed order: `Текущие`, then `Архив`.
- Minimum effective target height: 44 CSS pixels.
- Selected state uses text, shape, border/background and `aria-selected`; colour is supplementary.
- Visible focus works on selected and unselected tabs.
- Geometry and order are `never-learn`.

## Responsive boundary

This change has no separate mobile mode, list/detail navigation, bottom sheet, gesture or mobile-only transition. At narrow widths the existing lifecycle select remains the unchanged fallback; the new segment is a desktop enhancement only.

## Accessibility

The control uses `role=tablist`, two `role=tab` buttons, roving `tabindex`, labelled state and Left/Right/Home/End keyboard navigation. Hiding the compatibility select removes it and its owner label from visual and accessibility navigation only while the desktop segment is active.

## Data and safety

Viewing a lifecycle mode never archives or restores a plan. It changes only the query state and is `never-learn`. No source document, plan status, evidence, history, permission or persisted business fact changes.
