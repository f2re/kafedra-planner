# Motion contract — C-PLANS-LIFECYCLE-SEGMENT-245-V2

The lifecycle control uses only a restrained selection-state transition.

- duration: 120–180 ms;
- easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`;
- allowed properties: background, border and color;
- no bounce, scale pulse, page slide, blur or animated result counts;
- a new selection interrupts the previous transition and drives the existing source select immediately;
- list rendering and API work never wait for animation completion.

With `prefers-reduced-motion: reduce`, selection switches instantly. Focus, change dispatch, list reload, selection fallback and empty-state rendering remain identical.
