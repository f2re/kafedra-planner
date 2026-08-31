# Motion decision — document runtime reliability

Change: `C-DOCUMENT-RUNTIME-RELIABILITY-235`

## Decision

This change is predominantly **no-motion**.

Network classification, HTTP header normalization, package verification, package-cache writes, OCR smoke checks, full-install rejection and repair are correctness operations. Motion would not help the user understand them and must not delay, mask or imply success.

## State transitions

### Docomator

- `idle → checking`: reuse the existing disabled/busy button state; no layout shift is required.
- `checking → error`: replace the inline status text immediately. The card, fields and focus remain stable.
- `checking → success`: reveal the existing remote-source region through normal document flow. No celebratory animation, bounce or auto-scroll.
- `error → checking`: replace the status text with the current progress statement without first dismissing the prior error.

A short opacity transition already provided by shared UI styles is acceptable only when it does not change geometry or delay access. Maximum duration is 160 ms. No new animation dependency is added.

### Upload transport

Idempotency normalization is invisible and synchronous. There is no spinner, toast or extra stage for hashing the header value. Existing upload progress remains the only visible feedback.

### Installer and repair

Terminal output is sequential text. Package verification, smoke failure, rollback and success use no-motion. A line is printed only after the corresponding operation is complete; progress wording must not be reused as success wording.

## Reduced motion

Under `prefers-reduced-motion: reduce`:

- any nonessential opacity or disclosure transition is removed;
- fields, status and source controls appear in their final state immediately;
- focus and reading order are identical to the default mode;
- no status information is lost.

The implementation must remain fully usable when all animation durations are zero.

## Direct manipulation boundary

The user directly edits host, port and access code and explicitly invokes connection checking. The response follows that action in the same card. No automatic movement, focus capture, modal presentation or animated redirection is allowed.

## Performance and failure behavior

- UI state changes do not wait for a transition end event.
- Repeated checks cannot queue overlapping animations or requests.
- An aborted, timed-out or failed request returns the check action to an operable state immediately.
- Error copy is never temporarily hidden while a transition completes.
