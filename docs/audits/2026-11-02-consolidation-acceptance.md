# Acceptance — consolidation 2026-11-02

## Backlog

- probe/cleanup issues closed as not planned;
- explicit duplicates closed as duplicate with canonical replacement;
- superseded UI subtasks closed only when the replacement issue explicitly names them;
- canonical direct-completion flow remains authoritative.

## Frontend

- no confirmed unreachable duplicate lifecycle/origin module remains;
- no new parallel editor or navigation registry is introduced;
- existing plans/documents/plan-fact browser entry points remain reachable.

## UX/error safety

- password changes/admin reset use an application-owned masked form, not `window.prompt`;
- cancellation is non-mutating and focus returns to the initiator;
- technical document type is not required in the frequent template flow;
- affected async entry points show one observable error state;
- bulk AI application cannot overwrite a newer manual value or stale review state.

## Release

- ordinary PR checks and targeted tests pass on exact head;
- auth/security changes pass the existing risk gate;
- squash merge uses expected head SHA;
- next patch release tag and GitHub Release point to the verified exact `main` SHA;
- published bundle is the verified artifact.
