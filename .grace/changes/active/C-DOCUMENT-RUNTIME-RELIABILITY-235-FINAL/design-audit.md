# Independent design audit — C-DOCUMENT-RUNTIME-RELIABILITY-235-FINAL

## Scope inspected

- Existing organization/Docomator connection card and its classified inline failures.
- Unicode document intake transport on desktop `1440×900` and mobile `390×844`.
- Keyboard/focus behavior of the existing connection action.
- `prefers-reduced-motion` contract.
- Terminal full-bundle preflight and repair messages.

## Findings

### PASS — stable geometry

No new visible transport control, modal, confirmation step or competing primary action was introduced. Protocol, host, port, temporary access code, action and status remain in the existing card. Error text uses the existing status surface and wraps without changing page structure.

### PASS — actionable and private errors

DNS, refused connection, timeout, TLS, wrong service, not-ready and access-denied states have distinct operator copy. Unknown 5xx responses remain neutral. Stack traces, remote payloads, filesystem paths and access codes are not rendered.

### PASS — focus and keyboard

The existing action remains a native button with its established focus treatment and busy-disable behavior. Completion does not move focus to page start or introduce a focus-trapping overlay. Local organization editing remains reachable after integration failure.

### PASS — responsive behavior

The change does not add fixed-width content. Desktop and mobile Playwright paths exercise the same transport behavior, and the long original Unicode filename does not become a header or force horizontal page scrolling.

### PASS — motion

Failure, canonicalization, package-cache publication and installer rejection are static text-first states. No animation is required to understand or complete the flow. Existing busy feedback remains compatible with `prefers-reduced-motion`.

### PASS — adaptive UX classification

- access code: `never-learn`;
- connection/security result: `never-learn`;
- host, port and protocol: explicit server settings, not preference learning;
- space/group ordering: `rank-only`, never silent value replacement;
- file type: `domain-derived` with explicit correction stronger than a suggestion;
- transport hash: internal implementation, no user control.

## Blockers

None found in the implemented scope. The broader relocation of integration settings and organization master-detail redesign remain separate work under the parent UX audit and are not hidden inside this reliability change.
