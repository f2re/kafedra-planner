# Motion contract — C-PLANS-LIFECYCLE-DESKTOP-252-V5

## Decision: no-motion

The lifecycle switch is a frequent register operation. Immediate semantic state and server-backed list replacement are clearer than an animated indicator, so no transition, spring, slide, blur, scale or count animation is added.

The selected segment changes synchronously with `aria-selected`; persisted truth and list content continue to follow the existing lifecycle request. A second selection can interrupt an in-flight request through the existing controller without waiting for visual completion.

`prefers-reduced-motion` receives the same static behavior. The stylesheet includes an explicit reduced-motion rule to prevent future inherited transitions from changing this contract.

No mobile-only gesture, navigation animation or breakpoint-specific transition exists. Focus, keyboard action, empty-state text and error handling never depend on motion.
