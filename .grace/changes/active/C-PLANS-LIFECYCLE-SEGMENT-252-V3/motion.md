# Motion contract — C-PLANS-LIFECYCLE-SEGMENT-252-V3

## Decision

Use restrained selection feedback only. No page transition, list slide, scale pulse, bounce, blur animation, swipe interaction or mobile-specific motion is added.

## Transition

- trigger: explicit lifecycle tab selection;
- properties: background, border, shadow and text color only;
- duration: 140 ms;
- easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`;
- interruption: a new selection applies immediately and retargets the visual state;
- data request, focus and empty-state rendering never wait for transition completion.

With `prefers-reduced-motion: reduce`, all lifecycle-segment transitions are disabled and the selected state changes immediately. Static selected/unselected states carry the complete meaning.
