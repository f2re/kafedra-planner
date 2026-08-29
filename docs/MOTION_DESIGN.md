# Motion design for Kafedra Planner

## Purpose

Motion exists to explain causality, preserve spatial orientation, confirm direct manipulation, and make state change easier to understand. It is not a decorative layer. The product should feel Apple-inspired in the useful sense: clear hierarchy, restrained material, continuity between states, immediate response to input, and smooth movement that stops when the user has understood the change.

The source of truth for product hierarchy remains `docs/design.md`. This document defines how movement, opacity, blur, shape changes and gesture response support that hierarchy.

## Decision order

Before adding animation, answer in order:

1. What user state or relationship would be harder to understand without movement?
2. Is the trigger a tap, focus, drag, scroll, system event, async result, or navigation change?
3. Should progress be direct (gesture/scroll-linked), timed, or spring-driven after release?
4. What is the static state before and after the animation? Both MUST be understandable without motion.
5. What does `prefers-reduced-motion: reduce` do?
6. What is the performance budget on the supported desktop/mobile browser and Astra/Debian hardware?

If these questions do not produce a functional reason for motion, use `no-motion`.

## Apple-inspired motion character

- Clarity before spectacle. One dominant motion idea per interaction.
- Continuity before replacement. When the same object persists, interpolate its bounds, position, radius or emphasis instead of destroying it and creating an unrelated object.
- Direct manipulation is 1:1 while the pointer/finger moves. Easing starts after release, never between the pointer and the object.
- Frequent operational actions use little or no overshoot. Bounce is reserved for genuinely physical or exceptional feedback, not routine save/filter/navigation flows.
- Movement starts immediately after input. Do not add decorative delay before feedback.
- Secondary content may use subtle opacity/translation, but text and status may not become unreadable merely to stage an effect.
- Blur, glass, shadow and translucency communicate depth/material only. They are not substitutes for grouping, labels or contrast.
- Destructive and permission-sensitive actions remain explicit in text and state; motion cannot act as confirmation.

## Project timing defaults

These are Kafedra recommendations, not upstream facts. Exact values may be tuned to context and measured in browser tests.

| Interaction | Recommended character | Typical range |
|---|---|---:|
| Press feedback | immediate scale/opacity response | 70–140 ms |
| Checkbox/chip/tab state | short near-critical transition | 120–220 ms |
| Small disclosure/dropdown | position + opacity, low overshoot | 160–280 ms |
| Inspector/panel/sheet | continuity from edge/source | 220–360 ms |
| Large shared/morph transition | one coordinated progress | 260–420 ms |
| Success feedback | short and local | 220–450 ms |

Use `cubic-bezier(0.2, 0.8, 0.2, 1)` as a neutral ease-out starting point for non-physical timed motion, not as a mandatory constant. For spring behavior prefer critical or near-critical damping and retain release velocity only when the user directly manipulated the object.

## Geometry, opacity and material

- Prefer transform/opacity over layout-thrashing properties when the semantic geometry permits it.
- Small press scale is normally `0.96–0.99`; avoid shrinking text-heavy controls enough to affect readability.
- Secondary opacity normally stays at or above `0.55` if the element must remain readable.
- Backdrop opacity for transient overlays is usually restrained (`~0.08–0.28`) and MUST not obscure the object relationship.
- Border radius changes are acceptable when they explain expansion/collapse; keep related surfaces on the same radius system.
- Full-screen blur is prohibited by default. Local blur/glass requires contrast verification and performance evidence.
- Do not combine large rotation, blur, scale and opacity merely for richness. Choose the minimum channels that explain the transition.

## Gesture and interruption rules

- Drag/scroll progress maps directly to visual progress with no timing animation during active manipulation.
- Release may use velocity-aware spring, snap or decay when it preserves the user’s momentum.
- Thresholds must be visually inferable before a destructive/reordering commit.
- Repeated taps and route changes must interrupt or retarget an in-flight animation without leaving stale state.
- A cancelled gesture returns to a valid state; it never leaves hit targets displaced from their visual position.

## Reduced motion and accessibility

Every motion brief MUST specify `prefers-reduced-motion` behavior.

- Navigation and state changes remain immediate and semantically complete when movement is reduced.
- Continuous parallax, large spatial travel, rotation, procedural waves and motion blur are removed or replaced with a short fade/state update.
- Necessary focus/error/success feedback may remain as short opacity/color changes when it improves comprehension.
- Motion is never the sole indicator of selection, progress, error, completion or hierarchy.
- Keyboard focus must track the final logical control, not an animated visual clone.
- Interactive targets should normally provide at least a 44×44 CSS-pixel effective target where layout allows it.

## Performance

Target smooth 60 FPS for frequent UI transitions on supported devices. Avoid new animation libraries unless a separate approved change proves the need. Prefer existing browser primitives (`transform`, `opacity`, Web Animations/CSS transitions) and progressive enhancement. Effects that require large blur, canvas, WebGL or continuous animation need an explicit budget and a static fallback.

Do not run continuous animation while the relevant surface is off-screen or the page is hidden.

## Motion Advisor workflow

`kafedra-motion` receives the design intent, component, trigger, information density, frequency, importance, platform and accessibility/performance constraints. It searches `docs/design/reactiive-motion-catalog.md` by interaction intent, not visual novelty, and returns 2–5 candidates or `no-motion`.

For the selected pattern it produces a motion brief containing:

- user intent and why motion helps;
- reference demo(s) and source path/link;
- states and trigger;
- progress source and property mapping;
- geometry, opacity/material and layering;
- exact source-derived facts separated from Kafedra recommendations;
- timing/easing/spring and interruption behavior;
- gesture/velocity/threshold behavior where relevant;
- desktop/mobile differences;
- `prefers-reduced-motion` fallback;
- performance constraints;
- observable acceptance criteria.

Before implementation of a cited Reactiive pattern, inspect the current upstream source. A semantic catalog entry alone is not evidence for an exact duration, easing or spring constant.

## Default references for common Kafedra needs

- Active tabs/segmented controls: `dynamic-tab-indicator`, `fluid-tab-interaction`, `dynamic-blur-tabs` — prefer the first, most restrained geometry unless fluid material adds real orientation value.
- Inspector/panel expansion: `dot-sheet`, `floating-modal`, `scrollable-bottom-sheet` — preserve source-to-detail continuity; avoid full-screen theatrics.
- Reorder/direct manipulation: `drag-to-sort`, `magnet-spring`, `slide-to-reveal` — direct pointer mapping, velocity-aware release only.
- Status/microfeedback: `checkbox-interactions`, `loading-button`, `online-offline` — short local state change; no confetti for routine work.
- Theme/material: `interaction-appearance`, `theme-canvas-animation`, glass references — normally avoid in dense operational screens unless material change has a functional purpose.
- Data views: chart references may interpolate values, but axes/labels and numeric truth remain stable and readable.

## Audit boundary

`kafedra-motion` designs the motion specification. It does not approve its own implementation. `kafedra-design-audit` reviews the implemented result after `kafedra-feature` and before final test/release handoff.
