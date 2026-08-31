# Motion brief — reversible plans UX

Change: `C-PLANS-REVERSIBLE-UX-236`  
Role: `kafedra-motion`  
Decision: restrained disclosure motion; no-motion for lifecycle and domain commits

## Functional reason

Motion is useful only to preserve orientation when the secondary filters surface opens or closes. Lifecycle switching and source-row decisions are semantic data changes; motion would delay or obscure their persisted state, so those paths use no spatial animation.

## State machine

### Desktop filters

```text
closed
  -- trigger --> opening
opening
  -- 180 ms complete --> open
open
  -- trigger / Escape / outside pointer --> closing
closing
  -- 140 ms complete --> closed
```

An opposite action during opening or closing retargets from the current computed opacity and transform. The logical `hidden` state is applied only after closing completes.

### Mobile filters

The existing sheet layer owns open/close and focus containment. The filter sheet uses the same state machine as other Kafedra sheets; no second animation controller is introduced.

### Lifecycle

```text
active <-> archived
```

The selected segment, `aria-selected` and request parameters change immediately. Result loading may use the existing busy state, but the segment does not slide, bounce or wait for the network.

### Source-row decision

```text
included -> pending -> excluded
excluded -> pending -> included
pending -> error -> previous persisted state
```

There is no spatial transition. The status text and action label update after the committed response. A short local opacity or background-state transition is permitted, but meaning remains complete in a static frame.

## Recommended properties

### Desktop popover

- From: `opacity: 0`, `transform: translateY(-4px) scale(.99)`.
- To: `opacity: 1`, `transform: translateY(0) scale(1)`.
- Open: 180 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Close: 140 ms, same easing.
- Transform origin follows the filter trigger edge.
- No blur animation and no large travel.
- Layout position is calculated before the first visible frame, so collision correction does not jump on screen.

### Mobile sheet

- Reuse the existing sheet transform and backdrop.
- Recommended maximum duration: 240 ms open, 190 ms close.
- Backdrop opacity remains within the existing project value.
- The sheet does not overshoot and does not bounce.
- The fixed footer and hit targets move as one surface.

### Press and selection feedback

- Existing button press feedback may remain within 70–120 ms.
- Lifecycle selected styling may transition background, border and box-shadow for 140 ms.
- The selected text and `aria-selected` update immediately; transition is visual only.
- Exclude/restore busy state may use an existing spinner or text `Сохраняем…`; no looping decorative animation.

## Interruption and cancellation

- Repeated lifecycle activation while the same request is active is ignored or coalesced.
- Selecting the opposite lifecycle aborts or supersedes the previous list request; stale responses must not replace the latest state.
- Reopening a closing popover reverses from current progress.
- Closing a sheet restores focus only after its logical closed state.
- An API error returns the decision control to the last persisted state and leaves local task inputs unchanged.
- Hit-test geometry always matches the rendered control; no visual clone is used.

## Reduced motion

Under `prefers-reduced-motion: reduce`:

- popover and sheet appear and disappear immediately;
- segment background/shadow transitions are disabled;
- no transform is applied;
- busy and error states remain textual and announced;
- focus containment and restoration are unchanged.

## Performance budget

- Use CSS transform and opacity only for the disclosure transition.
- No new animation library.
- No continuous animation.
- Avoid animating width, grid tracks, left/top after initial placement, large blur or box-shadow interpolation across the page.
- The toolbar and list remain usable at 60 FPS on supported Astra/Debian hardware.

## Observable acceptance

1. Lifecycle state is semantically complete before any visual transition finishes.
2. Opening filters never moves the result list or sidebar.
3. Popover position is stable in its first visible frame.
4. Rapid open-close-open ends in the correct open state.
5. Escape closes and restores focus.
6. Reduced-motion screenshots contain the same hierarchy and selected states.
7. Source-row exclusion, impact confirmation and restoration are understandable with animations disabled.
