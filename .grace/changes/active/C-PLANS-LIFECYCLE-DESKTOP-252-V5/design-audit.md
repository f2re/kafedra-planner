# Independent design audit — C-PLANS-LIFECYCLE-DESKTOP-252-V5

## Decision: PASS

The implemented change was reviewed after the adapter, CSS, unit test and desktop Playwright path were present on the remote branch.

## Hierarchy

PASS. `Текущие | Архив` is a single persistent, mutually exclusive register control. The source select is removed from both visual and accessibility navigation after enhancement, so the screen has one lifecycle authority from the operator’s perspective. The control does not compete with archive/restore commands because it changes only the viewed register.

## State and data authority

PASS. The segment writes to the established `plans-lifecycle-status` select and emits its existing `input`/`change` events. It performs no direct `/api` call, no client-side filtering, no persistence and no archive/restore mutation. Existing server `status` filtering and selected-plan clearing remain authoritative.

## Keyboard, focus and target size

PASS. The two native buttons expose tablist/tab semantics, `aria-selected`, roving `tabindex`, Left/Right and Home/End behavior. Enter and Space retain native button activation. Focus is visible in both states. Computed desktop hit areas are at least 44 CSS pixels high and wide.

## Empty, repeated and rerendered states

PASS. Current and archive empty copy is distinct only when no secondary condition is active; filtered results retain the generic condition-specific message. A same-mode click emits no duplicate source change. Mutation observation reconnects a replaced lifecycle select once. Empty-state mutation writes are guarded, avoiding a self-triggering render loop.

## Motion

PASS. The final implementation uses no transition or animation. Static selection, focus and empty/error semantics are complete. The explicit `prefers-reduced-motion` rule prevents inherited motion from weakening that contract.

## Desktop-only boundary

PASS. No mobile mode, mobile navigation, bottom sheet, touch/swipe gesture, breakpoint-specific UI or mobile-only test was added. Existing unrelated responsive behavior was not changed. The segment itself uses bounded intrinsic sizing and does not introduce a second narrow-window interaction model.

## Remaining work outside this change

Compact secondary filters, source-row decisions, plan detail hierarchy and broader release visual review remain separate issues. They are not represented as complete by this PASS.
