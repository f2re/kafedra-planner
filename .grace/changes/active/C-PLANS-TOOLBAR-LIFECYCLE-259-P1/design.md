# Design contract — C-PLANS-TOOLBAR-LIFECYCLE-259-P1

## Scope

This is phase P1 of issue 259. It changes only the register lifecycle control. Rare-filter disclosure, tokens and response sequencing are separate later phases.

The product owner removed separate mobile modes. P1 therefore defines one shared desktop-first control and adds no mobile list/detail navigation, bottom sheet, swipe gesture, mobile-only action, breakpoint-specific state machine or mobile-focused acceptance.

## User goal

On opening **Планы**, the user must immediately choose between plans in current work and plans in the archive. Lifecycle is primary register navigation and cannot remain hidden among ordinary filters.

## Hierarchy

1. Existing title and plan actions.
2. Persistent `Текущие | Архив` segment.
3. Existing search and ordinary filters.
4. Existing list and detail panel.

The original lifecycle select remains only as a hidden compatibility bridge for the existing controller. It is not visible, focusable or announced as a second control.

## Interaction

- `Текущие` maps to `active`; `Архив` maps to `archived`.
- Click, native Enter and Space activate a tab.
- Left/Right wrap between tabs; Home/End select first/last.
- The adapter sets the hidden select and emits its established `change` event. It does not call an API, store a preference or filter a combined list.
- Search and ordinary filter values remain unchanged.
- Existing list loading clears a selected plan absent from the new response and chooses the first available plan.
- Selecting the already active tab is a no-op.

## States

- Loading retains the selected lifecycle state.
- Empty active result: `Текущих планов по этим условиям нет.`
- Empty archive result: `Архивных планов по этим условиям нет.`
- Empty text changes only when necessary, preventing an observer rewrite loop.
- No previous-plan detail remains after an empty response.
- Archive/restore operations remain synchronized through the same compatibility select.

## Visual and accessibility contract

- Fixed order: `Текущие`, then `Архив`.
- `role="tablist"`, horizontal orientation, two `role="tab"` controls, `aria-selected`, `aria-controls` and roving tabindex.
- Minimum tab height: 44 CSS pixels.
- Selection uses label, surface, border, shadow and accessibility state; color is supplementary.
- Visible focus works on selected and unselected tabs.
- Accepted geometry: desktop `1440×900` and constrained desktop `1024×768` without page-level horizontal spill caused by P1.
- No responsive breakpoint changes control semantics or creates a separate mobile mode.
- Lifecycle and geometry are `never-learn`.

## Rejected variants

Visible duplicate select, client-side filtering of a combined set, persistent last-used lifecycle, mobile-only controls, sheets, swipe navigation, animated page transitions and archive/restore actions inside the segment are rejected.
