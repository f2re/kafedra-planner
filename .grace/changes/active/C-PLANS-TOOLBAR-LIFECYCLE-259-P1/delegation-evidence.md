# Delegation evidence — C-PLANS-TOOLBAR-LIFECYCLE-259-P1

## Governance cleanup

- Issue 252 and its planning branches are superseded by issue 259 and are not implementation bases.
- The first `C-PLANS-COMPACT-TOOLBAR-259` planning branch is not continued because its approved plan references undefined `V-M-PLANS` and contains mobile-specific acceptance rejected by the product owner.
- P1 starts from exact main `e6c767949a19a9232e19d95fd8f0632d978f9e69`; its baseline passed before governed writes.

## Responsibility handoff

| Specialist | Responsibility | Result |
| --- | --- | --- |
| `kafedra-flow-intake` | Active/archive, loading, empty, repeated-selection and stale-detail states | One server-backed register view; persisted lifecycle is untouched |
| `kafedra-design` | Hierarchy, labels, tab semantics, focus and desktop/constrained geometry | `design.md` |
| `kafedra-motion` | Restrained selection feedback and reduced-motion fallback | `motion.md` |
| `kafedra-feature` | Thin adapter over the existing hidden lifecycle select | No API, database or duplicate state model |
| `kafedra-design-audit` | Independent source and interaction audit after implementation | `design-audit.md` |
| `kafedra-tests` | Deterministic unit contract, desktop Playwright and normal CI registration | Server query, focus, stale detail, empty state, overflow |
| `kafedra-release` | Exact-head checks, PR, squash merge, post-merge and terminal archive | No merge claim before GitHub confirmation |

No separate mobile mode, navigation, sheet, gesture or mobile-only acceptance is delegated. P2 remains blocked until P1 is merged, post-merge verified and archived.
