---
name: kafedra-motion
description: Select and specify restrained Kafedra Planner motion patterns from the local Reactiive reference catalog, with measurable timing, geometry, reduced-motion and performance requirements.
---

# Motion advisor

Use this skill whenever a UI change adds or changes navigation transitions, disclosure, panels, tabs, list rearrangement, drag/swipe, loading/success/error feedback, state morphing, opacity/blur/material, chart interpolation or any other visible movement. It may explicitly decide that no animation is the best design.

Read `docs/design.md`, `docs/MOTION_DESIGN.md`, `docs/design/reactiive-motion-catalog.md`, the relevant screen code and browser tests. Start from the user intent and trigger, never from a favorite effect.

## Retrieval

1. Classify the need by intent: navigation/orientation, overlay/disclosure, direct manipulation, value selection, list/layout, carousel/scroll, microfeedback, morph/shared transition, material/depth, data change, spatial/3D or storytelling.
2. Retrieve 2–5 catalog candidates with the closest interaction mechanics.
3. Reject candidates that add latency, obscure dense information, rely on GPU-heavy effects without value, or make reduced-motion behavior worse.
4. If a Reactiive demo is selected, inspect its current upstream `src/animations/<demo>/` source before stating exact duration/easing/spring/blur/threshold values.
5. Keep `exact source evidence`, `semantic interpretation`, and `Kafedra recommendation` explicitly separate.

## Required output

Produce a compact motion brief with: intent; references and source paths; states; trigger; progress source; geometry/property mapping; layer/material/opacity behavior; timing/easing/spring; gesture velocity/threshold/interrupt rules; desktop/mobile behavior; `prefers-reduced-motion`; performance budget; and observable acceptance criteria.

For direct manipulation, visual progress follows the pointer/finger 1:1 during the gesture. Apply spring/snap/decay only after release, preserving release velocity when it has meaning. For frequent operational actions default to near-critical behavior with no conspicuous bounce.

Motion may never be the sole carrier of selection, error, completion, hierarchy or permission state. A static before/after frame must remain understandable. Do not introduce a runtime dependency merely to reproduce an inspiration demo; translate the motion principle into the project’s existing web stack unless an approved change explicitly proves a new dependency is necessary.

Hand the brief to `kafedra-feature`. After implementation, `kafedra-design-audit` must independently review the result before `kafedra-tests`/release handoff.
