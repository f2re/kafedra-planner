# Design contract — C-DOCUMENT-RUNTIME-RELIABILITY-235-V2

## User result

The operator keeps working in the existing document and organization surfaces. The change does not add a wizard, confirmation screen or technical settings page.

### Upload

- A supported file is selected or dropped through the existing intake surface.
- The original Unicode filename remains visible and unchanged.
- Header canonicalization has no control, badge or explanatory copy because it is a transport implementation detail.
- Success continues to route to the exact created object; a failed sibling file does not hide successful results.

### Docomator

- Protocol, host, port, temporary access code, connection action and inline status remain in the existing integration card.
- Busy state disables only the current connection action and preserves entered values.
- A failure appears in the existing status region without alert, modal or layout replacement.
- Copy describes the cause and one correction: DNS/address, refused port, timeout, TLS, wrong service, not ready or invalid access code.
- Unknown 5xx failures remain neutral and never expose stack, remote response, filesystem path or secret.
- Manual organization management stays available regardless of integration state.

### Install and repair

The installer is a terminal interaction, not an application-screen redesign. Its states remain line-oriented and causal:

1. bundle/profile verification;
2. immutable package-cache publication;
3. additive-only package preparation;
4. full capability preflight;
5. control PDF and OCR smoke;
6. existing application transaction;
7. service/health verification.

A failure states what was not activated and that the previous release/data remain active. `doctor --repair` names the retained local payload and finishes with the same strict acceptance.

## Responsive and accessibility rules

- Existing card geometry is stable on desktop and mobile.
- Status copy wraps without horizontal page scrolling.
- The connection action preserves a minimum 44 px target.
- The status region is announced through the existing live-region contract.
- Focus remains on or returns to the connection action after completion; an error does not move focus to page start.
- Meaning is text-first and is not encoded only by color.
- Access code is `never-learn`; protocol/host/port are explicit server settings; space/group ordering is `rank-only` and never silently changes the selected value.

## Rejected variants

- Modal error dialogs.
- Automatic network or port scanning.
- A visible transport-hash field.
- A new blocking import-confirmation step.
- Treating degraded OCR as a successful full-bundle activation.
- Hiding the local employee editor when Docomator is unavailable.
