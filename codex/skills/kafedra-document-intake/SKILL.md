---
name: kafedra-document-intake
description: Designs Kafedra Planner upload/import intake so immutable sources are saved immediately, safe facts materialize automatically, files process independently and users correct only unresolved exceptions.
---

# Kafedra Document Intake

Use for document upload, plan import, meeting-source intake, supporting materials and other file-to-working-object flows.

## Interaction contract

For every intake define:

`intent → trigger → immediate feedback → source persisted → async processing → working result → exceptions/recovery`

Do not collapse these states into one global “loading” flag.

## Immediate feedback

After file selection/drop:

- create one visible row per file;
- show local upload progress when useful;
- distinguish `uploading` from `source saved` from `processing`;
- allow the user to continue working once the immutable source is safely registered.

Never claim processing success merely because upload finished.

## Save source before interpretation

The immutable source/version, original name, hash and locator basis are registered before background extraction/materialization can be considered authoritative.

Optional OCR/preview/LLM failure must not invalidate a source already saved.

## Automatic materialization

If deterministic classification/extraction can safely create or update a working object, do it without a mandatory confirmation page. The resulting object remains editable and linked to evidence.

After an upload that created a plan/object, select/open **that exact result** rather than whichever active item happens to be first.

## Multi-file and partial success

Files process independently. Summaries use truthful aggregate state such as:

`5 готово · 2 требуют внимания · 1 ошибка`

One failure never disables already-ready files or the rest of the app.

## Ambiguity

Ambiguous fields/rows become exceptions with source context. Safe facts continue. Do not ask the user to “approve” every extracted value.

## Retry and idempotency

A retry must identify what failed:

- upload not persisted → retry upload;
- source persisted, extraction failed → retry extraction only;
- materialization failed → retry domain operation with idempotency key;
- optional preview/OCR unavailable → retry capability without duplicating document/domain objects.

Preserve user input and the saved `documentId`/equivalent across temporary failures.

## Common-path decisions to remove

Do not ask for parser engine, OCR implementation, storage target, document hash or internal processing mode when the system can determine them safely.

Ask for document purpose/type only when it materially changes domain semantics and cannot be inferred with acceptable certainty. Prefer a small high-level choice (`Основание / План / Материал`) over technical formats.

## Cancellation

Cancelling an in-flight optional process does not delete an already-saved source. Make the resulting state explicit: source available, processing cancelled/paused, retry possible.

## Patterns

- Per-file local progress/state.
- Source-first persistence.
- Automatic safe materialization.
- Review by exception.
- Result-specific navigation.
- Idempotent targeted retry.
- Optional capability degradation rather than core failure.

## Anti-patterns

- `Upload → Confirm → Process → Confirm import → Apply` conveyor for reversible data.
- Global spinner for one document.
- Reuploading a saved file to retry OCR/materialization.
- One bad row rolling back unrelated successful rows.
- Selecting a stale previously-open object after upload instead of the created result.
- Treating optional OCR/LLM absence as “document upload failed”.
- Discarding file/form state after a network/server error.
