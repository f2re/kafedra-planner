# Motion contract — C-PLANS-COMPACT-TOOLBAR-259

Motion explains only selection, disclosure and local removal feedback. It never gates data or changes layout authority.

## Segment selection

- duration: 120–180 ms;
- easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`;
- properties: background-color, border-color, color and a restrained shadow;
- no bounce, scale pulse, spring or sliding list;
- a second selection interrupts the first and starts the server query immediately.

## Filter disclosure

- desktop popover: 160–220 ms opacity plus at most 6 px translate;
- constrained/mobile sheet: 200–280 ms transform/opacity, direct and interruptible;
- fields are interactive as soon as the panel is visible; query work never waits for transition end;
- closing by Escape or outside click returns focus after the DOM state changes.

## Tokens and results

- token creation/removal may use 100–160 ms opacity only;
- no FLIP movement of the result list and no animated result count;
- loading and empty states are understandable without animation;
- stale responses are ignored by state logic, not hidden by transitions.

## Reduced motion

Under `prefers-reduced-motion: reduce`:

- segment selection changes instantly;
- popover/sheet opens and closes instantly or with opacity no longer than 80 ms;
- token changes are immediate;
- focus, query dispatch, selection fallback and empty-state behavior are identical.

No upstream demo code or animation asset is redistributed.
