# Design contract — C-DOCUMENT-RUNTIME-RELIABILITY-235-FINAL

## Operator flow

The change keeps the existing document intake and organization integration surfaces. It adds no confirmation page, technical hash field or blocking modal.

- Upload keeps the original Unicode filename visible. Header normalization is invisible.
- Docomator keeps protocol, host, port, temporary access code, action and inline status in one stable card.
- A classified failure explains one cause and one correction while retaining all entered non-secret values.
- Unknown server failures remain neutral and never expose stack traces, remote responses, paths or secrets.
- Manual organization work remains available when the integration is unavailable.

The terminal full-bundle flow is ordered as: archive verification → package-cache verification/publication → additive package preparation → full capability preflight → control OCR → existing application transaction. Failure explicitly states that the application release was not activated.

## Responsive/accessibility

- Existing desktop/mobile geometry is unchanged by status.
- Status text wraps without horizontal page scroll and is announced in the existing live region.
- The connection action keeps a minimum 44 px target and visible focus.
- Focus remains on or returns to the initiating control after success/failure.
- Meaning is text-first and not color-only.
- Access code is `never-learn`; protocol/host/port are explicit settings; space/group ordering is only `rank-only`.

## Rejected variants

Modal errors, port scanning, visible transport hashing, automatic security defaults, silent degraded full activation and hiding local employee editing are rejected.
