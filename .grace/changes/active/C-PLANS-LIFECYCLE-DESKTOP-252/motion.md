# Motion contract — C-PLANS-LIFECYCLE-DESKTOP-252

## Decision: no-motion

Lifecycle switching is a frequent register filter. Immediate semantic response is more useful than animated continuity, so the segment adds no movement, slide, bounce, scale, blur or delayed indicator.

- Trigger: click, Enter, Space, Left, Right, Home or End.
- State change: `aria-selected`, `tabindex`, source-select value and existing list request update immediately.
- Interruption: a subsequent action immediately becomes authoritative; no animation queue exists.
- Loading and errors: existing plans feedback remains visible and does not wait for motion.
- Desktop: static selected/unselected surfaces only.
- Mobile: no mobile-specific mode or transition is introduced; the existing narrow-width select remains unchanged.
- `prefers-reduced-motion`: identical behavior because the implementation contains no required transition.
- Performance: no animation frame loop, transform layer, blur or runtime dependency.

Acceptance: a static screenshot fully communicates selection, keyboard focus remains visible, and no data operation depends on an animation event.
