# Delegation evidence — C-PLANS-COMPACT-TOOLBAR-259

## Controller

Base: `main@e6c767949a19a9232e19d95fd8f0632d978f9e69` (`tree c786711af18cbf8616ad624a21db4f2b147ca22d`)  
Issue: #259  
Branch: `ux/plans-compact-toolbar-259`

The change is one UI-only vertical. Specialists own completed responsibilities, not arbitrary file sets. The lead controller performs integration and regression audit after every handoff.

## Specialist responsibilities

### kafedra-flow-intake

Defines lifecycle/search/filter/selection/loading/empty/error transitions and the minimum path:

```text
open plans → find/filter → select plan
```

Archive and restore remain separate object commands. No confirmation screen is added for safe list navigation or filter changes.

### kafedra-design

Owns `design.md`, hierarchy, responsive geometry, copy, keyboard/focus contract and reference analysis. Exact evidence:

- `f2re/docomator@cfccc70d29385ae7715aeb8746711c9e1df310da`;
- `f2re/planer-solving@15e6b943f465ca25586f0c657a137bc3bf9f2b73`.

Only interaction semantics are adapted. Source, CSS, assets and fonts are not copied.

### kafedra-motion

Owns `motion.md`, no-motion boundaries, timing, interruptibility and reduced-motion parity.

### kafedra-data

Confirms no schema/migration is required. The authoritative state is the existing `/api/plans` query plus server result. Request sequence ids are client projection safety, not a new data source.

### kafedra-feature

Implements the real `plans-next` toolbar and removes the duplicate lifecycle query override/select from `lifecycle-safe`. No heuristic DOM discovery module is introduced.

### kafedra-design-audit

Runs only after implementation. It must inspect the actual plans screen at desktop 1440×900, constrained 1024×768, mobile 390×844, keyboard, 200 percent zoom and reduced motion. It writes `design-audit.md`; the feature author does not self-certify blockers.

### kafedra-tests

Adds focused unit and actual-screen Playwright regression for lifecycle, search, disclosure, tokens, focus, empty states, stale responses and overflow. Full existing tests remain mandatory.

### kafedra-release

Verifies exact-head GRACE/project/browser/release/offline/database checks, squash merge, post-merge checks and separate archive-only terminal transition.

## Scope isolation

Allowed writes are exactly those listed in approved `plan.xml`. Source-row decisions, plan detail/mobile navigation, meeting UX, API, migrations, release version and dependencies are excluded. No two specialist roles write the same contract concurrently.
