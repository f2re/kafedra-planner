---
name: kafedra-motion-continuity
description: Specifies restrained Kafedra Planner motion for document/list/inspector continuity, local processing feedback and direct manipulation with immediate response, interruption, reduced-motion and performance contracts.
---

# Kafedra Motion and Continuity

Use whenever a Kafedra UI change introduces visible movement or changes how list/detail/upload/review states transition. `no-motion` is a valid and often preferred result.

## Purpose gate

Add motion only when it improves at least one:

- causality: the user can see what their action changed;
- orientation: list item → inspector/detail relationship remains clear;
- direct manipulation: dragged/reordered content follows the pointer/finger;
- local async feedback: a specific file/action visibly progresses;
- state continuity: the same object changes state without appearing to be replaced by unrelated UI.

If none apply, use no-motion.

## Character

- immediate input response;
- near-critical, restrained movement for frequent work;
- no conspicuous bounce on save/filter/navigation/completion;
- one dominant motion idea per interaction;
- transform/opacity preferred when semantics allow;
- static before/after states remain fully readable.

## Document-workflow patterns

### List → inspector

Preserve selection and spatial relationship. A small inspector/panel transition may use roughly 220–360 ms as a starting range, but exact constants are implementation recommendations, not universal facts.

### Upload/processing

Progress belongs to the file row. Transition `uploading → saved → processing → ready/attention/error` locally; never animate the whole page as if it were blocked.

### Completion

`Выполнено` gives immediate pressed/pending feedback, then a short local persisted-state transition. Do not use confetti, large bounce or page travel for routine completion.

### Review next-item

After a correction, preserve the inspector's structure and update content/selection smoothly enough to maintain context. Do not stage long exit/entrance animations for every exception.

### Reorder/split

During active drag, movement follows pointer/finger 1:1. Snap/spring can occur after release. The source/provenance meaning must remain explicit before commit.

## Interruption

Repeated selection, navigation or state updates must interrupt/retarget in-flight motion. Never leave hit targets at logical coordinates different from rendered controls.

## Reduced motion

For `prefers-reduced-motion: reduce`:

- remove large travel, parallax, repeated movement, rotation and motion blur;
- use immediate layout/state change or a short non-spatial fade where useful;
- keep focus, selection, status, error and source relationships explicit without motion.

## Performance

Target smooth frequent interactions on supported browsers/hardware. Avoid new animation runtimes unless a separate approved change proves necessity. Do not run continuous animation off-screen or while the document is hidden.

## Required brief

For material motion specify:

- user intent;
- trigger/state machine;
- progress source;
- properties/geometry changed;
- timing/easing or gesture mapping;
- interruption/cancellation;
- desktop/mobile differences;
- reduced-motion fallback;
- performance budget;
- observable acceptance criteria.

## Patterns

- Source-to-detail continuity.
- Local per-row processing feedback.
- Immediate press/pending → persisted state.
- Direct manipulation 1:1 while active.
- Short, interruptible operational transitions.
- Explicit no-motion decision.

## Anti-patterns

- Page fade/scale on every navigation.
- Confetti or bounce for normal task completion.
- Full-screen blur/glass used to create “premium feel”.
- Spinner animation without text/state truth.
- Animated movement that hides source/status changes.
- Delayed feedback so the interface waits for animation before reacting.
- Motion as the only selection/error/completion cue.
