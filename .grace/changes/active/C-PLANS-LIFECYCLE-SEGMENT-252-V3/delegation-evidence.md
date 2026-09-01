# Delegation evidence — C-PLANS-LIFECYCLE-SEGMENT-252-V3

## Supersession

- `C-PLANS-LIFECYCLE-SEGMENT-252` is not continued because its approved plan included a separate mobile acceptance scope removed by the product owner.
- `C-PLANS-LIFECYCLE-SEGMENT-252-V2` is not continued because its baseline referenced undefined durable verifier `V-M-PLANS`.
- V3 starts from exact `main` `e6c767949a19a9232e19d95fd8f0632d978f9e69`, uses only defined graph/verification anchors and passed branch baseline before governed writes.

## Responsibility handoff

| Specialist | Responsibility | Result |
| --- | --- | --- |
| `kafedra-flow-intake` | Active/archive, loading, empty, repeated-selection and stale-detail states | One server-backed register view; persisted lifecycle is untouched |
| `kafedra-design` | Hierarchy, labels, tab semantics, focus and stable desktop/narrow-window geometry | `design.md` |
| `kafedra-motion` | Restrained selection feedback and reduced-motion fallback | `motion.md` |
| `kafedra-feature` | Thin adapter over the existing hidden lifecycle select | No API, database or duplicate state model |
| `kafedra-design-audit` | Independent source/interaction audit after implementation | `design-audit.md` |
| `kafedra-tests` | Deterministic unit contract and focused desktop Playwright | Server query, focus, stale detail, empty state, overflow |
| `kafedra-release` | Exact-head checks, PR, squash merge, post-merge and terminal archive | No merge claim before GitHub confirmation |

No separate mobile mode, navigation, bottom sheet, gesture or mobile-only state is delegated.
