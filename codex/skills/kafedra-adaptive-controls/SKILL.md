---
name: kafedra-adaptive-controls
description: Applies Kafedra Planner's stable adaptive UX rules to defaults, option ranking and domain-derived values without moving geometry, learning unsafe decisions or overriding saved/current user choices.
---

# Kafedra Adaptive Controls

Use whenever a design proposes remembering, learning, ranking, suggesting or automatically choosing a value based on previous use or context.

## Classify every adaptive control

### `safe-default`

A safe default for a **new** object may learn from repeated explicit successful choices. Examples may include non-sensitive category, importance or reminder when project rules allow it.

### `rank-only`

Options may be reordered inside a list, but the neutral/current/saved value is never silently replaced. Typical filters and selectors for existing objects belong here.

### `domain-derived`

The value is reliably inferred from authoritative domain context and outranks usage statistics: clicked calendar day, saved object date, exact source row, unique employee match, organizational supervisor, current plan period.

### `never-learn`

Never learn frequency-based defaults for security/ACL/role, PIN/password/token, completion/return/archive/restore/delete-like decisions, approvals, free business text, comments, search queries or other decisions where frequency can change authority/business meaning.

## Priority order

Always preserve this precedence:

```text
saved domain fact
  → explicit current user choice
  → domain-derived value
  → safe personal default
  → static fallback
```

A programmatic/defaulted value does not become a learned user preference merely because it was rendered or submitted unchanged.

## Stable geometry

Learning may rank options or choose an allowed starting value. It may not:

- move buttons/tabs/sections;
- reorder primary navigation;
- change the hierarchy of actions;
- hide a control because it was rarely used;
- turn a frequent dangerous action into the default primary action.

## Dates

Do not learn stale absolute dates. If a project permits date preference learning, use bounded relative semantics from a meaningful base date. Explicit selected day and domain-derived dates always win.

## Existing objects

Editing always begins with the object's saved values. Never replace them with learned defaults.

## Failure behavior

Preference read/write failure must not block the domain action. Adaptive preference is auxiliary, not source of truth.

## Patterns

- Explicit classification before adaptive behavior.
- Stable geometry.
- Domain context stronger than statistics.
- Learn only explicit human choices after successful domain persistence where relevant.
- Neutral/current/saved value preserved in rank-only lists.
- Safe fallback when preference storage fails.

## Anti-patterns

- “Smart” UI that moves frequent buttons around.
- Learned default overriding the day the user clicked.
- Programmatic suggestion counted as a user choice.
- Existing object opening with the user's usual value instead of its saved value.
- Learning PINs, free text, search queries, ACL or completion/archive decisions.
- Storing an old absolute date as a future default.
- Preference-layer failure blocking save/import/completion.
