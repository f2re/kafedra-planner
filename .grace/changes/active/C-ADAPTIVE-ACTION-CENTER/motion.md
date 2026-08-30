# kafedra-motion — motion brief

## Intent

Explain that one temporary action surface was opened from the topbar or calendar day while preserving orientation. Motion is not used to communicate permission, selection, classification, success or error.

## States and mapping

- closed → open desktop: opacity 0→1, translateY 8→0, scale .99→1;
- closed → open mobile: opacity 0→1, translateY 18→0;
- backdrop: opacity only;
- action press: near-critical scale .99 while pressed;
- progress and route changes: text/state replacement without spatial animation.

## Timing

- dialog disclosure: 180 ms ease-out;
- backdrop: 160 ms ease;
- no bounce, spring, continuous animation, animated blur or delayed completion;
- interaction remains interruptible by Escape and navigation.

## Direct manipulation

Drag-over feedback changes the upload border/background immediately and follows pointer state without inertia. Dropping a file ends the visual state synchronously before upload begins.

## Desktop and mobile

Desktop preserves the source button and application frame. Mobile uses the same content in a bottom-attached surface; there is no lateral carousel or gesture-only dismissal.

## Reduced motion

`prefers-reduced-motion: reduce` removes animation and transition. The final static dialog retains the same header, recommendations, upload area, groups and status.

## Performance budget

No runtime animation dependency, canvas, continuous frame loop or full-screen moving layer. Only transform/opacity on one bounded dialog and opacity on one backdrop are permitted.

## Acceptance

Playwright emulates reduced motion and verifies `animation-name: none`, zero transition duration and a fully readable static state. Keyboard dismissal and focus restoration remain independent of animation.
