---
name: kafedra-provenance-and-inspector
description: Designs Kafedra Planner inspectors and source navigation so working facts remain editable while immutable documents, extracted candidates, versions, locators, links and history remain visible and trustworthy.
---

# Kafedra Provenance and Inspector

Use for document/object detail, evidence, extracted values, version history, source links and cross-object navigation.

## Inspector role

The inspector is the predictable place to answer:

- what is this object;
- what is its current working state;
- where did it come from;
- what was extracted vs manually corrected;
- what linked objects/projections exist;
- what can the user do next;
- what happened previously.

Do not make users hunt across unrelated modal dialogs for source/history/actions.

## Evidence ladder

Show evidence at increasing detail:

1. compact readable origin in list/detail (`Из плана · стр. 4 · строка 12`);
2. source excerpt/cell/table locator near a disputed field;
3. exact document version / locator / extraction metadata in advanced detail.

Minimalism may shorten the display; it may not sever the evidence path.

## Editable interpretation, immutable evidence

A manual correction creates/updates the working fact. Preserve:

- original machine candidate/raw value;
- source document version;
- locator;
- extraction rule/model when relevant;
- correction author/time/history.

Do not overwrite the only stored extracted value with corrected text.

## Projection links

Calendar, search, report, plan/fact and review representations link to the authoritative object. If the user edits from a projection context, the operation must still update the authoritative object first and then refresh projections.

## Cross-object navigation

Use readable relationships:

- `Основание` → directive/document;
- `Из пункта плана` → plan item/source row;
- `Задача` → assignment;
- `Материалы` → linked immutable document versions;
- `Событие в календаре` → projection with origin.

Keep the user's return context when following links.

## History

History is chronological, specific and secondary to current work. Show meaningful domain transitions and corrections; avoid dumping raw audit JSON into the primary view.

## Archive/successor semantics

An archived object may show a successor for navigation, but historical evidence must continue to point to the original source/version/object. Never rewrite old links merely to make the archive look cleaner.

## Patterns

- Compact provenance with exact drill-down.
- Current value + source candidate + correction history when material.
- Stable inspector sections: state/action, source, links, history/technical detail.
- Projection → authoritative object navigation.
- Return-context preservation.

## Anti-patterns

- Hiding version/locator access to achieve a cleaner screenshot.
- Editing OCR/extraction in place and losing the raw candidate.
- Treating search/calendar/report rows as independent editable copies.
- Showing only internal IDs without readable origin text.
- Making raw audit metadata the main reading experience.
- Repointing historical evidence to a replacement/archive successor.
