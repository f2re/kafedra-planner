# Independent design audit — C-PLANS-LIFECYCLE-DESKTOP-285

## Scope

The audit covers the plans toolbar at desktop widths, pointer and keyboard operation, focus, target size, lifecycle-state continuity, empty states, reduced motion and restoration of the pre-existing select below the desktop breakpoint.

## Results

### PASS — hierarchy and one-action navigation

`Текущие | Архив` is permanently visible next to search on desktop and is visually separated from ordinary filters. It changes only the list view; archive and restore remain separate explicit object actions.

### PASS — existing data and server authority

The segment dispatches normal input/change events to the existing `#plans-lifecycle-status` bridge. The established lifecycle controller continues to set `status=active|archived`, refresh the server list and clear or replace an invalid selected detail. No client-side merge, API, SQLite, migration, evidence or plan-status mutation was introduced.

### PASS — keyboard and focus

The control exposes tablist/tab semantics, `aria-selected`, roving tabindex and visible focus. Click, Enter, Space, horizontal/vertical arrows, Home and End produce the same result. Targets are at least 44 px.

### PASS — desktop-only boundary

The segment activates only for `(min-width: 721px)`. Below the breakpoint it is removed and the original select attributes are restored. No mobile navigation, sheet, gesture, list/detail mode or mobile-only transition was added.

### PASS — state and motion

Current, archive and filtered empty states are distinguishable, while loading and errors are not overwritten. Selection feedback is optional and restrained; `prefers-reduced-motion` removes transitions without changing focus, request or render behavior.

## Blockers

None found in the approved scope.
