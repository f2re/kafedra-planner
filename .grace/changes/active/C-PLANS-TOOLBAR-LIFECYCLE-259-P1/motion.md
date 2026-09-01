# Motion contract — C-PLANS-TOOLBAR-LIFECYCLE-259-P1

## Decision

Use restrained selection feedback only. No page transition, list slide, scale pulse, bounce, blur animation, swipe interaction or mobile-specific motion is added.

## Transition

- trigger: explicit lifecycle tab selection;
- properties: background, border, shadow and text color only;
- duration: 140 ms;
- easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`;
- interruption: a new selection applies immediately and retargets the visual state;
- request, state, focus and empty-state rendering never wait for transition completion.

With `prefers-reduced-motion: reduce`, all lifecycle-segment transitions are disabled. Static selected and unselected states carry the complete meaning.
