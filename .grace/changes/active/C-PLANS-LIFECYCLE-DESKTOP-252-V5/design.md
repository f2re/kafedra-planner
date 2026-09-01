# Design contract — C-PLANS-LIFECYCLE-DESKTOP-252-V5

## Entry and goal

The user opens `Планы` on the working desktop and immediately sees one mutually exclusive register control: `Текущие | Архив`. It is placed in the existing plans toolbar before secondary filtering and remains visible while list results change.

## State and source of truth

The existing lifecycle select and its `status=active|archived` server request remain the only state authority. The new segment is a presentation adapter: it writes the selected value to that control and emits the established change event. It never filters a combined client list, archives/restores an object, persists a preference or learns from usage.

The source select is hidden from visual and accessibility navigation after enhancement, preventing two visible controls for one state. Archive/restore operations that update the source select continue to synchronize the segment.

## Interaction

- One click, Enter or Space selects a mode.
- Left/Right and Home/End use roving tab focus and select the reached mode.
- Search and ordinary filter controls retain their actual values.
- If the selected plan is not returned in the new server result, the established plans controller clears or deterministically replaces the detail; the adapter never displays a stale copy.
- When no secondary condition is active, empty copy is `Текущих планов нет` or `Архив пуст`. Filtered no-results retain the generic condition-specific message.

## Hierarchy and styling

- Fixed order: `Текущие`, then `Архив`.
- Selected state uses label, surface shape, border and `aria-selected`; color is supplementary.
- Effective height is at least 44 CSS pixels.
- Focus is visible on selected and unselected segments.
- Existing project typography, surfaces, radii and focus tokens are reused; no remote asset or runtime dependency is added.

## Desktop-only boundary

No mobile-specific mode, list/detail navigation, bottom sheet, gesture, breakpoint-specific control, mobile test matrix or mobile-only transition is introduced. Existing unrelated responsive behavior is not edited. Narrowing the window does not create a second interaction model.

## Error, loading and empty states

The adapter does not create a second loader or error surface. Existing list loading/error behavior remains authoritative. Repeated clicks on the already selected mode do not emit a duplicate request. If the source lifecycle control is rerendered, the adapter reconnects once and removes the stale segment.

## Adaptive classification

Lifecycle view is `never-learn`. Statistics cannot choose the state, change the order, move the control or convert programmatic synchronization into a learned user preference.
