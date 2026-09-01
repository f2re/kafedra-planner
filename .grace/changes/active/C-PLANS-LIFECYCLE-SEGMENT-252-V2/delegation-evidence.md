# Delegation evidence — C-PLANS-LIFECYCLE-SEGMENT-252-V2

## Supersession

Planning-only commit `7721df3a995bd4a998f22708ee93073586fe28cc` is not continued because its approved plan included a distinct mobile acceptance scope. The product owner removed that scope. The approved files are not rewritten; this V2 change starts from exact `main` and supersedes the abandoned planning branch.

## Assigned responsibilities

| Specialist | Responsibility | Handoff |
| --- | --- | --- |
| `kafedra-flow-intake` | Define active/archive, loading, empty, repeated-selection and stale-detail states | One server-backed lifecycle view with no persisted status mutation |
| `kafedra-design` | Define hierarchy, labels, tab semantics, focus and stable desktop/narrow-window geometry | `design.md` |
| `kafedra-motion` | Decide restrained selection feedback and reduced-motion fallback | `motion.md` |
| `kafedra-feature` | Implement a thin adapter over the existing hidden lifecycle select | No API, database or duplicate state model |
| `kafedra-design-audit` | Independently inspect actual desktop, narrowed-window, keyboard, focus, empty and reduced-motion behavior | `design-audit.md` with PASS/REVISE/BLOCK |
| `kafedra-tests` | Prove server query, bridge compatibility, stale detail, empty state and accessibility semantics | Unit plus desktop Playwright evidence |
| `kafedra-release` | Enforce exact-head CI, squash merge, post-merge CI and archive-only terminal transition | Confirmed GitHub objects only |

No separate mobile specialist scope, mobile state machine, mobile navigation or mobile-specific acceptance is delegated.
