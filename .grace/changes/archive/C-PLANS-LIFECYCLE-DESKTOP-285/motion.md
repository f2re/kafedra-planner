# Motion contract — C-PLANS-LIFECYCLE-DESKTOP-285

The result must be understandable without animation. Only background, text color and shadow may transition for 150 ms using `cubic-bezier(0.2, 0.8, 0.2, 1)`.

No page slide, scale, bounce, blur, animated count or mobile transition is introduced. Fetching, selection, focus and rendering never wait for animation.

With `prefers-reduced-motion: reduce`, transition duration is zero and the same keyboard/focus behavior remains available.
