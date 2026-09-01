# Design contract — C-PLANS-COMPACT-TOOLBAR-259

## Design authority and references

This change follows `docs/design.md`, `docs/UX_FLOWS.md`, `docs/MOTION_DESIGN.md` and issue #239. It adapts semantic patterns from two repositories at exact commits:

- `f2re/docomator@cfccc70d29385ae7715aeb8746711c9e1df310da` — calm two-state segmented controls, reliable 44 px targets, selected state expressed by shape and text, `min-width: 0` and safe reflow.
- `f2re/planer-solving@15e6b943f465ca25586f0c657a137bc3bf9f2b73` — compact grouped toolbars, stable desktop controls and static reflow on constrained widths.

No CSS, JavaScript, icons, fonts or assets are copied. The implementation is native to Kafedra Planner variables, components and data flow.

## User hierarchy

The first working row has exactly three responsibilities:

```text
[ Текущие | Архив ]   [ Поиск по планам…                ]   [ Фильтры N ]
```

1. `Текущие | Архив` is primary collection navigation, not a data mutation and not a rare filter.
2. Search remains permanently visible because it is the fastest direct path to a known plan or item.
3. `Фильтры N` progressively discloses kind, period, direction and responsible. These controls do not compete with the primary lifecycle mode until requested.
4. Active rare conditions appear below as short tokens. The user can understand and remove one condition without reopening the panel.

The toolbar is one dominant surface. It does not create nested card chrome or an overflow menu for the lifecycle mode.

## Lifecycle segment

- Fixed order: `Текущие`, then `Архив`.
- Native buttons with `role="tab"` inside `role="tablist"`.
- Selected state is communicated by label, surface, border and `aria-selected`; color is supplementary.
- One click/tap or native Enter/Space selects a view.
- ArrowLeft/ArrowRight move and select adjacent segments; Home/End select the first/last.
- Minimum target is 44×44 px.
- The segment changes only list query state. `В архив` and `Восстановить` remain separate object commands with impact behavior.
- Classification: `never-learn`.

## Search

- Search uses the remaining horizontal space and never moves into the disclosure on desktop.
- The value survives lifecycle and rare-filter changes.
- Clearing search keeps lifecycle and rare filters.
- Search is not converted into a token and is not learned.
- During a request, the input stays editable; a stale response cannot replace newer results.

## Filter disclosure

Desktop:
- `Фильтры N` anchors a compact popover aligned to the trigger.
- Width is bounded by the workspace and viewport; no overlap with sidebar and no page horizontal scroll.
- Fields use a two-column grid where space permits, one column when constrained.
- Changes apply immediately through the existing query. There is no mandatory `Применить`.
- `Сбросить` appears only when at least one rare filter is active.
- Escape and outside click close the panel. Focus returns to `Фильтры N`.

Mobile/constrained:
- The same semantic panel reflows to the viewport width; at mobile 390×844 it may use a bottom-attached sheet presentation.
- It contains the same controls and state, not a parallel mobile form.
- A visible close action and Escape are supported.
- Safe-area and 44 px targets are preserved.

The disclosure is `never-learn` for geometry and values. Future ranking is not implemented.

## Filter tokens

Stable order:

1. Вид
2. Период
3. Направление
4. Ответственный

Each token contains a human label and current visible value, for example `Период: 2026/27`. The remove button has an accessible name `Снять фильтр …`, a 44 px hit area and clears exactly one control. Long values truncate visually but retain full text in accessible name/title. Tokens wrap; they never create horizontal page scrolling.

## Loading, selection and empty states

- Lifecycle or filter changes immediately clear an invalid/stale detail before new content arrives.
- Valid selection is retained only if the latest server result still contains it.
- List and detail use monotonic request sequence ids; older responses are ignored.
- Empty current collection: `Текущих планов пока нет. Загрузите план или создайте новый.`
- Empty archive: `В архиве пока нет планов.`
- Search/filter miss: `Планов по выбранным условиям нет.`
- The lifecycle segment, search and filter control remain available in every empty state.

## Responsive geometry

- 1440×900: one-row toolbar; master-detail remains unchanged.
- 1024×768: toolbar reflows predictably without overlapping the navigation or shrinking controls below target size.
- 390×844: lifecycle segment and search remain visible; filter panel fits the viewport; no page-level horizontal spill. This does not implement issue #258 list-to-detail navigation.
- 200 percent zoom: content wraps; it is not clipped or hidden behind floating controls.
- Position and order never change from usage statistics or result count.

## Accessibility and copy

- Every icon-like action has a text or accessible label.
- Focus is visible on selected and unselected segments, disclosure trigger, fields and token removal.
- Status is not communicated by color alone.
- Russian labels describe the user action; internal API terms are not shown.
- Live status is used only for result/empty feedback, not for every keystroke.

## Out of scope

Plan-detail redesign, source-row exclusion, new API fields, saved views, mobile list-to-detail navigation, archive impact changes and meeting UX.
