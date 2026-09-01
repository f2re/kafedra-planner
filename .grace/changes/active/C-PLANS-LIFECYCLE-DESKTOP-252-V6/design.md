# Design contract — C-PLANS-LIFECYCLE-DESKTOP-252-V6

## Product boundary

This change improves only the desktop presentation of the existing plan lifecycle register. It does not create a new lifecycle value, client-side list, archive action, preference or mobile navigation flow.

## Desktop hierarchy

At viewport widths from `721 px`, `Текущие | Архив` is a persistent two-option segmented control in the plans filter toolbar. It represents the list’s primary register mode and remains visually distinct from search and ordinary filtering.

The existing `#plans-lifecycle-status` select remains the single state and compatibility authority. The desktop segment changes the select value and emits its ordinary `input` and `change` events. API requests, selection reconciliation and rendering continue through the established lifecycle controller.

## Narrow-width fallback

Below `721 px` the desktop segment is removed. The source select and its owner are restored with the exact pre-enhancement `hidden`, `aria-hidden` and `tabindex` state. No list/detail state machine, bottom sheet, gesture, mobile-only navigation or mobile-only animation is introduced.

Returning to desktop width recreates one segment only, synchronized to the current select value. Repeated rerenders or width changes must not accumulate controls or event listeners.

## Interaction and accessibility

- Fixed order: `Текущие`, then `Архив`.
- One click, tap on a desktop pointer device, Enter or Space changes the mode through the native button behavior.
- Left/Right arrows, Home and End move and activate the corresponding tab.
- Container: `role="tablist"`; options: `role="tab"` with correct `aria-selected` and roving `tabindex`.
- Minimum interactive height and width: `44 px`.
- Focus indication remains visible for selected and unselected tabs.
- Selected state uses label, surface, border and `aria-selected`; color is supplementary.
- Search and ordinary filter values remain unchanged.
- If the selected plan is not present after the server response, stale detail cannot remain visible.

## Empty states

- Active register without secondary conditions: `Текущих планов нет`.
- Archive without secondary conditions: `Архив пуст`.
- Any empty result with search or another non-default condition: `Планов по этим условиям нет.`

## Adaptive classification

Lifecycle view is `never-learn`. Usage statistics cannot choose a value, reorder the two tabs, move the control or change the breakpoint. Persisted plan lifecycle is a domain fact and is not modified by viewing a register.

## Rejected variants

- Dropdown-only desktop navigation.
- Separate client-side filtering of a combined active/archive list.
- A visible archive/restore action inside the segment.
- Mobile list/detail mode, bottom sheet, swipe gesture or breakpoint-specific data state.
- A transition that delays API work, focus, selection reconciliation or fallback restoration.
