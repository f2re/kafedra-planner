---
name: kafedra-template-and-structured-document-flow
description: Designs Kafedra Planner template, field-mapping and generated-document workflows around source previews, structured anchors, versioned templates and testable output without turning routine document work into a generic document editor.
---

# Kafedra Template and Structured Document Flow

Use for plan templates, meeting/protocol templates, extraction templates, field mapping and generated DOCX-like outputs.

## Scope boundary

Kafedra Planner is not a universal office-document editor. A template workflow exists to define repeatable structured fields/anchors and generate or extract domain documents while preserving exact versions and evidence.

Do not recreate Word/LibreOffice editing chrome inside the product unless a proven task requires it.

## Template library

A template list/detail should make visible:

- purpose/type;
- current/main status where relevant;
- version;
- last test/validation state;
- impact/usage when changing or archiving;
- actions: test, make primary, archive/restore, create new version.

Historical generations remain linked to the exact template version used.

## Field/anchor mapping

When mapping a source document:

1. keep source/preview visible or one action away;
2. show the selected field/anchor and its source context;
3. distinguish required/optional/repeating semantics;
4. validate with a representative test extraction/generation;
5. surface ambiguity as a fixable issue;
6. preserve draft work after recoverable errors.

Avoid long disconnected property forms where users must remember what part of the document they are describing.

## Preview

Preview is a verification aid, not the source of truth. If optional LibreOffice rendering is unavailable, the template/version and generated DOCX can still be valid; state the capability degradation honestly.

## Versioning

Editing an applied/historical template should create a new version when the domain contract requires immutability. Do not silently mutate a version already referenced by generated documents.

## Generation

Generation should state the exact template version and selected data scope. Repeating an unchanged request should be idempotent where the domain supports it. Register generated output through the normal immutable document intake path.

## Patterns

- Source/preview adjacent to mapping.
- Versioned template library with explicit primary/current status.
- Test extraction/generation before activation.
- Historical generation pinned to exact template version.
- Draft preservation across errors.
- Optional preview degradation without blocking valid DOCX/source work.

## Anti-patterns

- Building a full office editor for simple structured mapping.
- Field settings far from the source region they refer to.
- Mutating a historical template version in place.
- Making preview rendering a prerequisite for valid generation.
- Hiding template version from generation history.
- Generating duplicates on repeated identical requests.
- Requiring users to confirm every deterministic field mapping result before using the template.
