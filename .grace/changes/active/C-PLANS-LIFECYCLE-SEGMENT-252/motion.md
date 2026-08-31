# Motion contract — C-PLANS-LIFECYCLE-SEGMENT-252

The control uses only a restrained selection-state transition.

- duration: 120–180 ms;
- easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`;
- allowed properties: background, text color, border and shadow/indicator state;
- the new mode and server request become active immediately; animation never delays state, focus or keyboard input;
- a new selection interrupts the previous visual transition;
- list content is not slid across the page and result counts are not animated;
- bounce, scale pulse, blur and decorative loading progress are prohibited.

With `prefers-reduced-motion: reduce`, selection state changes instantly. Empty-state rendering, focus, server requests and stale-detail clearing never wait for an animation event.
