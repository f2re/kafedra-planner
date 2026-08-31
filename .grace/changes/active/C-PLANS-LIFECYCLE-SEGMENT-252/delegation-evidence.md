# Delegation evidence — C-PLANS-LIFECYCLE-SEGMENT-252

## kafedra-flow-intake

Defined the minimal path `Планы → Архив → Текущие`, preservation of search/secondary filters, deterministic stale-detail clearing and mode-specific no-result states. Confirmed that viewing a mode never mutates persisted plan lifecycle.

## kafedra-design

Selected a persistent two-segment control as the primary register mode. Fixed order, 44 px targets, text/shape/aria selection, desktop intrinsic width and mobile full-width behavior. Classified the control as `never-learn`.

## kafedra-motion

Approved only a 120–180 ms interruptible selection transition. Server requests, focus and semantic state update immediately. Reduced motion is instant.

## kafedra-feature

Implementation is constrained to a small adapter loaded after `lifecycle-safe.js`. The existing hidden select and its change handler remain the sole internal state bridge; the adapter performs no direct fetch or local filtering.

## kafedra-tests

Verification covers pure mode/key behavior, static integration contract, click and keyboard activation, exact server status query, preserved search, stale detail, mode-specific empty state, 44 px targets, exact desktop/mobile sizes, no page-level overflow and reduced motion.

## Handoff status

Design and motion decisions are approved for implementation after GRACE current and baseline gates pass on the exact branch base.
