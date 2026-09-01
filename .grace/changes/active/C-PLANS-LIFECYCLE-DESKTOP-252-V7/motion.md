# Motion contract — C-PLANS-LIFECYCLE-DESKTOP-252-V7

## Decision

Lifecycle register switching is intentionally **no-motion**. The semantic state, request, focus and empty result must be complete without a transition.

- Segment buttons use `transition: none` and no keyframe animation.
- Selection changes immediately when the source select changes.
- API work and stale-detail reconciliation never wait for animation completion.
- Width changes detach or restore controls synchronously from the media-query state.
- No slide, fade, scale, bounce, shake, blur, progress animation or animated count is introduced.
- No swipe, drag or touch gesture is introduced.

## Reduced motion

With `prefers-reduced-motion: reduce`, desktop and mobile/narrow fallback behavior is identical: selection, focus, empty text and source-select restoration switch immediately. No operation depends on an animation event or duration.
