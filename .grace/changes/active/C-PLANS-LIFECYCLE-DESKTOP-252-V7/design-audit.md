# Independent design audit — C-PLANS-LIFECYCLE-DESKTOP-252-V7

## Scope inspected

- Desktop plans toolbar at `1440×900` and constrained desktop `1024×768`.
- Existing lifecycle select as the sole state and API authority.
- Keyboard behavior, focus indication and 44 px target geometry.
- Width transition `1440 → 720 → 1440` and exact source-select restoration.
- Empty current, archived and secondary-filter states.
- `prefers-reduced-motion` and absence of mobile-specific interaction state.

## Findings

### PASS — hierarchy and one-action navigation

At desktop widths the primary register is continuously visible as `Текущие | Архив`. It is separated from ordinary filters and requires no dropdown open. It does not contain archive/restore commands and therefore cannot be mistaken for a destructive action.

### PASS — single state authority

The segment has no API, storage or client-side filtering model. It updates the existing `#plans-lifecycle-status` select and emits its established events. Server `status=active|archived`, existing list loading and stale-detail reconciliation remain authoritative.

### PASS — desktop geometry and focus

Both tabs have a minimum `44×44 px` target. Selected state uses text, surface and `aria-selected`, not color alone. `:focus-visible` remains legible on selected and unselected tabs. Roving `tabindex`, arrows, Home and End provide deterministic keyboard navigation.

### PASS — narrow/mobile fallback

Below `721 px` the segment is removed and the pre-existing select/owner state is restored exactly, including `hidden`, `aria-hidden` and `tabindex`. No mobile list/detail mode, bottom sheet, gesture, navigation state or mobile-only animation was introduced. Re-expansion creates one segment and preserves the current lifecycle value.

### PASS — empty and stale-detail states

The list distinguishes `Текущих планов нет`, `Архив пуст` and `Планов по этим условиям нет.` Existing controller behavior clears a selected plan that is absent from the new server result, so old detail cannot remain as a false current selection.

### PASS — motion and adaptive UX

The control uses no transition or keyframe animation. `prefers-reduced-motion` is functionally identical. Lifecycle view is `never-learn`: usage cannot choose, reorder, relocate or resize it.

## Blockers

None found in the implemented scope. Compacting the remaining secondary filters is a separate future issue and is not coupled to this change.
