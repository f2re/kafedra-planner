# Design handoff — reversible plans UX

Change: `C-PLANS-REVERSIBLE-UX-236`  
Role: `kafedra-design`  
Status: approved for implementation after successful GRACE baseline  
Base: `main@4969c6af8520e52b1aa8812804b70ed77b508e0f`

## User outcome

The plans screen must answer four questions without expanding a configuration wall:

1. Am I viewing current plans or the archive?
2. Which period and search query are active?
3. Are secondary filters narrowing the result?
4. Can an incorrectly recognized source row be removed from active work and restored without losing evidence?

The common scan path remains visible. Rare filters and consequence details appear only when requested.

## Reference matrix

The implementation reuses principles, not source assets or a foreign component framework.

| Reference | Proven pattern | Kafedra adaptation |
| --- | --- | --- |
| `f2re/docomator@cfccc70d29385ae7715aeb8746711c9e1df310da`, `apps/api/ui/styles.css` | compact segmented control, 44 px targets, one search field, selected state on a calm surface | lifecycle becomes the first control in the plans toolbar; existing Kafedra tokens, buttons and surface variables remain authoritative |
| same commit, `apps/api/ui/interaction-contract.css` | `min-width: 0`, bounded controls, wrapping/reflow instead of page overflow | toolbar children and popover use `minmax(0,1fr)`, `max-inline-size`, collision-safe positioning and no horizontal page scroll |
| `f2re/planer-solving@15e6b943f465ca25586f0c657a137bc3bf9f2b73`, `web/frontend/assets/operator-flow.css` | restrained grouped controls, clear selected state, one primary action and short press feedback | plans toolbar is a single operational row; upload/create actions remain in the page heading and do not compete with filters |
| same commit, `web/frontend/assets/unified-operations.css` | sticky workspace controls, desktop sticky and mobile reflow | toolbar may remain sticky below the application topbar; desktop disclosure is anchored, mobile disclosure uses the existing sheet geometry |
| current `public/lifecycle-safe.js` | document lifecycle already uses a visible segmented `В работе / Архив` | plans use the same one-click semantic contract; the existing lifecycle `select` is removed rather than duplicated |
| current `public/plans-next.css` | sticky modal header and mobile bottom-sheet geometry | filter sheet and impact confirmation reuse existing layer, radius, backdrop and focus behavior |
| current `public/plan-source-rows-next.js` | inline source-row workbench preserves editor input after error | exclusion and restoration live in this workbench; no separate source-row administration page is created |

## Information hierarchy

### Page heading

The heading keeps the plan title, short explanation and existing primary creation/import actions. It does not contain lifecycle or secondary filters.

### Operational toolbar

Desktop order is fixed:

```text
[ Текущие | Архив ]  [ Поиск по планам…          ]  [ Период ▼ ]  [ Фильтры 2 ]
```

The order never changes from usage statistics.

- Lifecycle: `never-learn`; always visible.
- Search: `never-learn`; always visible; no remembered query.
- Period: `rank-only`; neutral `Все периоды` remains the default.
- Filters: disclosure trigger; active count reflects kind, direction and responsible person only.
- Reset appears inside the disclosure when at least one secondary filter is active.
- The existing page-level plan actions remain the only primary actions.

### Desktop geometry

- Toolbar uses one dominant surface with a single border and radius; nested controls do not each become cards.
- Lifecycle target: minimum 44 px height.
- Search grows with `minmax(220px,1fr)`.
- Period uses a bounded width of roughly 160–220 px.
- Filter trigger remains fully visible and never shrinks below its label.
- Popover aligns to the trigger end edge, uses `min(360px, calc(100vw - safe gaps))`, and is repositioned left when the right edge would exceed the workspace.
- The popover must not overlap the fixed sidebar. Its left boundary is the workspace content boundary, not the page viewport origin.
- Opening the popover does not move the results list.

### Mobile geometry

At widths up to 720 px:

```text
[ Текущие | Архив ]
[ Поиск…                     ]
[ Период ▼ ] [ Фильтры 2 ]
```

- No toolbar element causes horizontal page scroll at 320 px.
- `Фильтры` opens the existing bottom-sheet layer.
- The sheet header is fixed within the sheet: title, active count and close.
- The sheet body contains kind, direction and responsible person as full-width labelled controls.
- The footer contains `Сбросить` only when relevant and the primary local action `Показать`.
- Closing by `Esc`, close button, backdrop or successful `Показать` restores focus to the trigger.
- The mobile bottom navigation remains visible or receives safe-area spacing according to the existing sheet contract.

## DOM and state contract

The implementation should expose stable selectors for tests and future maintenance.

```html
<div class="plans-toolbar" data-plans-toolbar>
  <div class="plans-lifecycle-segmented" role="tablist" aria-label="Состояние планов">
    <button data-plan-lifecycle="active" role="tab" aria-selected="true">Текущие</button>
    <button data-plan-lifecycle="archived" role="tab" aria-selected="false">Архив</button>
  </div>
  <label class="plans-search">…</label>
  <select id="plans-period">…</select>
  <button data-plan-filters-toggle aria-expanded="false" aria-controls="plans-filter-popover">
    Фильтры <span id="plans-filter-active-count">0</span>
  </button>
  <section id="plans-filter-popover" class="plans-filter-popover" hidden>…</section>
</div>
```

Authoritative client state:

```text
lifecycle: active | archived
query: string
periodKey: string
secondary: { kind, direction, responsible }
filtersOpen: boolean
selectedPlanId: string | null
```

Every request to `GET /api/plans` includes the lifecycle status. The UI must never load `status=all` and hide one lifecycle locally.

The lifecycle segment updates `aria-selected`, active styling and request state immediately. Results update from the server response. Repeated activation of the already selected segment performs no duplicate preference write and should not issue a needless reload.

## Source-row decision model

Each source row visibly carries one of two semantic states:

- `В плане` — the row may be materialized and its linked items participate in active projections.
- `Не включена` — the source and evidence remain visible, but projections changed by the exclusion are not active.

The workbench summary uses three filters:

```text
[ Требуют проверки N ] [ В плане N ] [ Не включены N ]
```

The `Не включены` filter is always discoverable when the count is non-zero. An excluded row must never disappear without a restoration route.

### Editor placement

The decision control is placed in the source-row editor header, next to the source identity and before task fields:

```text
Строка 7 · Таблица 2
Не включена в план
[ Вернуть в план ]
```

For an included row:

```text
Строка 7 · Таблица 2
В плане
[ Не включать в план ]
```

The original cells disclosure remains available in both states. Task editing and materialization controls are disabled for an excluded row with nearby explanatory text; they are not merely greyed out without a reason.

## Decision flow

### Immediate exclusion

When impact reports no meaningful active links:

1. The user activates `Не включать в план`.
2. The server commits the row decision and safe projection changes.
3. The row receives the text state `Не включена`.
4. A non-modal notice states `Строка не участвует в плане` and exposes `Вернуть`.
5. Repeating the same request returns the persisted state and does not add history.

No confirmation modal is shown for this reversible no-impact case.

### Confirmable impact

When active generated items, active assignments, calendar entries, supporting links or meeting references would be affected:

1. The first request returns a structured impact.
2. The current editor stays open and retains all form data.
3. An impact sheet lists concrete counts and names, for example:
   - `2 пункта плана будут отменены`;
   - `1 активное поручение будет отменено`;
   - `2 календарные записи перестанут быть активными`;
   - `3 материала останутся в истории`.
4. The primary action is `Не включать и отменить связанные обязательства`.
5. The secondary action is `Оставить в плане`.
6. The reason is optional and never learned.
7. Only the explicit confirmed request changes data.

### Blocked impact

Completed work or an item whose authority is manual/currently edited is not silently rewritten.

The sheet states which object blocks the automatic operation and provides navigation to that object. The exclusion request returns no partial write. The source row remains included until the operator resolves the work state through its normal domain action.

### Restoration

`Вернуть в план` restores only projection states captured and changed by the corresponding exclusion.

- A projection edited after exclusion is not overwritten.
- Preserved evidence and decision history remain.
- Materialization becomes available again.
- Repeating restore is idempotent.

## Loading, empty and error states

- Lifecycle or filter reload: keep existing list visible with `aria-busy=true`; do not replace the entire page with a spinner.
- Empty active state: `Нет текущих планов` plus the existing import/create action.
- Empty archive: `Архив пуст`; no import action is duplicated inside the archive result.
- No filter match: state names active filters and exposes one `Сбросить фильтры`.
- Network/API error: keep lifecycle, query, period, secondary values and selected plan; render an inline retry message adjacent to the list.
- Decision error: keep the source-row editor and all task inputs; announce the error in the editor action area.
- Repeated click while a decision is in flight: disable only the decision action and expose `aria-busy`; unrelated navigation remains usable.

## Visual language

- Reuse `--surface`, `--surface-muted`, `--border`, `--text`, `--muted`, `--accent-soft`, `--accent-strong`, existing radius and shadow variables.
- Lifecycle selected state uses surface + subtle shadow + text weight, not colour alone.
- Excluded state uses text, status pill and subdued row treatment. The source text remains readable.
- Impact severity uses headings and explicit counts; colour is secondary.
- No new gradients, oversized cards, decorative icons or remote font.
- Search, period and filter trigger align to the same control height.
- Long Russian labels wrap inside the impact sheet and never widen it.

## Keyboard and accessibility

- Tab order follows lifecycle buttons, search, period, filters, then results.
- Arrow Left and Arrow Right may move within the lifecycle tablist; Enter/Space activates.
- `Esc` closes popover/sheet without changing filters and restores focus.
- Popover has a labelled region; mobile sheet uses dialog semantics and focus containment.
- Filter count has an accessible name, not only a visual badge.
- Source-row status is announced in text; decision result uses an `aria-live="polite"` notice.
- Destructive confirmed exclusion names the object and consequence.
- Effective targets are at least 44 by 44 CSS pixels.
- At 200% zoom and 320 px width, no essential action is clipped or reachable only by horizontal page scroll.

## Adaptive UX classification

| Control | Class | Rule |
| --- | --- | --- |
| Current / Archive | `never-learn` | explicit current state only; no ranking or default learning |
| Search | `never-learn` | never persisted as preference |
| Period | `rank-only` | options may rank; neutral default remains |
| Kind / direction / responsible | `rank-only` | options may rank, selected state never replaced |
| Filters disclosure | static | opening frequency never changes placement |
| Exclude / restore / confirm / reason | `never-learn` | no automation, no learned confirmation |
| Source-row machine suggestion | `domain-derived` candidate | remains evidence-backed and subordinate to explicit decision |

## Acceptance map to the reported problems

- Plan filters overflow: resolved by one bounded toolbar and a collision-safe disclosure.
- Archive requires two clicks: resolved by a permanent segmented control.
- Incorrect recognition cannot be removed: resolved by reversible inclusion state and impact-aware projection handling.
- Evidence could be lost: explicitly prohibited; source and decision history remain.
- Mobile density: resolved by toolbar reflow and existing bottom-sheet geometry.
- Interface consistency: lifecycle, focus, surfaces and target sizes reuse established project patterns.
- Visual adaptation: geometry remains fixed; only safe option ranking is allowed.
