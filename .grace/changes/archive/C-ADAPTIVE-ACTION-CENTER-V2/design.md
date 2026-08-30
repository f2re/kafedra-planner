# kafedra-design — flow specification

## Entry and goal

Entry points are `+ Добавить`, `Ctrl/Cmd+N`, and `+` on a concrete calendar day. The operator either starts an existing subject flow or drops one document and lets the deterministic intake choose the subject destination.

## Stable hierarchy

1. Header and close action.
2. Deterministic search.
3. Exactly three recommendation slots with fixed geometry.
4. One universal upload area as the primary document path.
5. Six fixed groups containing existing actions.
6. Inline processing/error state that never erases the selected file or source identity.

Frequency may reorder actions only. It never changes groups, slot count, labels, a date, a saved value, permissions, completion, deletion or document classification.

## States

- idle: fixed recommendations, upload and catalog;
- filtered: all six group containers remain visible and groups without matches say so;
- uploading: file name and immutable-save progress are visible;
- processing: the same dialog remains open while the exact documentId is polled;
- routed: the exact created/linked object opens;
- needs review: source remains saved and the review/document destination opens;
- failed processing: source remains saved and the error is shown without asking for a second upload.

## Desktop

Centered surface up to 880 px, two-column group grid, three equal recommendation cards. Existing application navigation remains visible behind a restrained backdrop.

## Mobile

Bottom-attached surface, one-column recommendations and groups, safe-area padding, identical actions and upload capability. Density is reduced rather than squeezing desktop columns.

## Keyboard and accessibility

- focus enters search and is trapped inside the open dialog;
- Escape closes and restores the invoking control;
- Ctrl/Cmd+N opens the same dialog;
- labels and status carry meaning without color or motion;
- consequential actions remain text-labelled;
- exact calendar date remains visible in the destination form.

## Evidence and safety

The dialog never claims an inferred type before worker completion. Routing reads the extraction result of the uploaded document. Protocol conflicts remain review items and existing values are not overwritten.

## Observable acceptance

Desktop and mobile Playwright must prove the fixed slots/groups, keyboard/focus, exact day date, exact uploaded plan and degraded/reduced-motion behavior.
