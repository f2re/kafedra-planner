# Independent design audit — C-PLANS-LIFECYCLE-DESKTOP-252

## Verdict

**PASS** for the approved desktop-only scope.

## Evidence reviewed

- Actual `public/plans-lifecycle-desktop.js` and `public/plans-lifecycle-desktop.css` implementation.
- Focused unit contract in `tests/plans-lifecycle-desktop.test.mjs`.
- Desktop Playwright flow at `1440×900` in `tests/browser/plans-lifecycle-desktop.spec.mjs`.
- Existing lifecycle controller and server-status regression remain the state authority.
- `npm run design:check`, `npm run check` and `npm run docs:check` pass on the implementation checkout.

## Findings

### PASS — hierarchy

`Текущие | Архив` is always visible on the desktop plans surface and is visually separated from ordinary search/filter controls. The hidden compatibility select is not a competing visible control.

### PASS — semantic state

The selected state is expressed by the Russian label, segment shape, border/background, `aria-selected` and roving `tabindex`. Colour is not the sole signal.

### PASS — interaction and focus

Click, Enter, Space, Left, Right, Home and End use native button/tab behavior. Focus remains visible on selected and unselected segments. Effective height is at least 44 CSS pixels.

### PASS — data authority

The adapter performs no API request and stores no preference. It changes the existing lifecycle select and dispatches its established events. Search and ordinary filters are untouched; the established plans controller remains responsible for server requests and stale-detail removal.

### PASS — empty and error states

Unfiltered empty current and archive modes are distinguishable as `Текущих планов нет` and `Архив пуст`. A secondary search/filter preserves the generic `Планов по этим условиям нет.` text. Existing loading and error surfaces remain authoritative.

### PASS — motion

The change intentionally uses no motion. No state, request, focus operation or list replacement waits for an animation event. `prefers-reduced-motion` produces the same immediate result.

### PASS — mobile boundary

No mobile list/detail mode, bottom sheet, gesture, navigation or mobile-only transition was introduced. At narrow widths the unchanged source select is restored as the existing compatibility fallback; this is not a separately designed mobile workflow.

## Remaining work outside scope

Compact secondary filters, source-row decisions, plan detail hierarchy and archive/restore actions remain separate desktop iterations. They are not hidden inside this change.
