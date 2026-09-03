# Motion contract — C-DOCOMATOR-UPDATE-0-4-2-303

## Decision: no-motion

The connection and import path is an administrative document workflow. Its result must be immediate and unambiguous, so this change intentionally adds no animation, transition, skeleton, progress sweep, bounce, scale, slide, blur or delayed reveal.

Checking and importing are represented by concise status text and disabled controls for the duration of the active request. Connection badge, error text, source selectors and totals update synchronously with state changes; network and rendering never wait for visual effects.

With `prefers-reduced-motion: reduce`, behavior is identical because there is no introduced motion to remove. Keyboard focus, status announcements, retry, source selection and import remain fully available.
