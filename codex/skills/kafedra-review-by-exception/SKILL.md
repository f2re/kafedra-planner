---
name: kafedra-review-by-exception
description: Designs Kafedra Planner Review surfaces as queues of real ambiguity and repair, allowing safe facts/rows to proceed while preserving source context and avoiding mandatory approval of deterministic results.
---

# Kafedra Review by Exception

Use when extracted fields, plan rows, employee matches or other automatic candidates can be ambiguous.

## Review is not approval

The Review area exists because the system cannot safely decide something, not because every automatic result needs a human signature.

A safe deterministic result should already be usable. Review contains only unresolved exceptions or explicit diagnostics.

## Exception item contract

Each item should show enough to decide without leaving the surface:

- object/row identity;
- source excerpt/cell/locator;
- proposed value(s);
- why the system could not decide;
- impact of leaving it unresolved;
- smallest correction action.

Use plain language such as `Найдено два сотрудника с таким ФИО`, not parser/confidence jargon alone.

## Partial success

The existence of exceptions must not hide or roll back ready data. A plan with 40 safe rows and 2 ambiguous assignees is a usable plan with 2 questions, not a failed import.

## Correction semantics

Correction updates the working fact/link while retaining raw extraction/evidence. When a correction is persisted, remove the exception only if its ambiguity is truly resolved.

Do not interpret merely opening/previewing an exception as acceptance.

## Queue behavior

- sort by actionability/impact, not arbitrary technical severity;
- allow filtering/grouping by object/type/source;
- after save, advance predictably to the next exception while keeping context;
- support keyboard next/previous where efficient;
- show `Нет вопросов для проверки` as a valid healthy state.

## Batch resolution

Bulk resolution is allowed only when the user can see the shared rule/scope and the same decision is semantically valid for every selected item. Never bulk-accept uncertain facts merely because their parser confidence is similar.

## Auto-resolution

If later domain data makes an exception deterministic (for example a unique exact employee match), the system may resolve/materialize it automatically only under the same evidence/idempotency rules and without overwriting a prior explicit manual correction.

## Patterns

- Exception-only queue.
- Source context adjacent to correction.
- Ready data remains live.
- Predictable next-exception navigation.
- Manual correction outranks later guesses.
- Healthy empty state.

## Anti-patterns

- Every extracted row waits for `Принять`.
- Manager approval queue for normal task completion.
- Confidence percentage without explanation/source.
- Full document re-import required to fix one row.
- Automatic reprocessing silently overwriting a manual correction.
- One ambiguous employee blocking unrelated plan items.
- “Resolve all” that accepts heterogeneous uncertain facts blindly.
