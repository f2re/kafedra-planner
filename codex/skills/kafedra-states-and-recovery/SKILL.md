---
name: kafedra-states-and-recovery
description: Defines Kafedra Planner document/task async, empty, partial, offline, capability-degraded, error, retry and cancellation states so saved data remains usable and one failed item never blocks unrelated work.
---

# Kafedra States and Recovery

Use for upload, extraction, OCR/preview, materialization, saving, search, integrations, completion and any async document-workspace behavior.

## State truth first

Name states from the user's persisted reality, not implementation internals.

For document intake distinguish at minimum when relevant:

- uploading;
- source saved;
- processing;
- ready;
- needs attention;
- processing failed but source available;
- optional capability unavailable.

Do not label all of these `Ошибка` or `Загрузка`.

## Locality

Pending/error state belongs to the smallest meaningful object. One OCR job does not disable Documents; one failed row does not disable the plan; one failed external adapter does not block local work.

## Persisted truth vs optimistic feedback

Controls may respond immediately, but success wording follows the committed domain result. If persistence fails, restore a coherent state and retain user input.

Repeated clicks must not create duplicate domain operations.

## Partial success

Batch operations report ready/attention/error counts and keep successful outputs accessible. Provide per-item diagnosis/retry. Do not roll everything back simply to present one binary state.

## Offline and capability degradation

Core deterministic work remains available without Internet/LLM. Optional integrations, OCR, preview, delivery or LLM enrichment show honest capability state and targeted diagnostics.

A missing optional capability must not visually turn a saved document into a failed document.

## Retry matrix

Before offering `Повторить`, know what is retried and what is reused:

- upload → only if source was not persisted;
- extraction/OCR → reuse saved version/blob;
- materialization → reuse source/extraction and idempotency key;
- projection refresh → rebuild projection, do not recreate source object;
- external sync → preserve local truth and retry adapter only.

## Cancellation

Cancel optional/in-flight work without deleting already committed source/domain data. State what remains available and how to resume/retry.

## Empty states

Differentiate:

- no data yet;
- no results for filters/search;
- no review exceptions;
- capability unavailable;
- permission prevents access.

Each has a different next action.

## Form recovery

On validation/network/server error, preserve entered values and file/document references that were already persisted. Focus/announce the actual problem and allow correction without rebuilding the whole form.

## Patterns

- User-language persisted states.
- Local pending/error indicators.
- Partial success counts + per-item recovery.
- Idempotent targeted retry.
- Optional-capability degradation.
- Retained form/input state.
- Healthy empty Review state.

## Anti-patterns

- Global spinner or disabled app for one local job.
- Generic “Something went wrong” with lost input.
- Retrying materialization by uploading the file again.
- Treating optional OCR/LLM/network adapter failure as loss of the saved document.
- Optimistic `Готово` before commit.
- Duplicate objects from repeated clicks/retries.
- Binary batch failure when some items succeeded.
- Cancel action that silently deletes already-saved source data.
