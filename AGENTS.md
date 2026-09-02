# AGENTS.md

Эти правила действуют для всего репозитория `kafedra-planner` и дополняют `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` и профильные документы в `docs/`.

## Перед изменением

1. Получить фактический `refs/heads/main` и точный SHA его дерева.
2. Прочитать `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, относящиеся к задаче документы, открытые Issues, последние коммиты и текущий CI.
3. Не реализовывать повторно уже существующий контур и не переносить старую ветку поверх нового `main` без проверки фактического diff.
4. Существенную работу зафиксировать в GitHub Issue с критериями приёмки.
5. Создать короткую рабочую ветку от точного проверенного SHA `main`.

## Обязательный Kafedra workspace preflight

После репозиторного и GRACE preflight, но до проектирования или реализации любого существенного изменения обязательно прочитать `codex/skills/kafedra-workspace-orchestrator/SKILL.md`. Он классифицирует задачу и выбирает минимальный набор профильных skills из pinned snapshot `codex/skills/kafedra-profile.json`; все 14 профильных skills доступны локально и не требуют сети.

Приоритет неизменен: `AGENTS.md` → approved GRACE change → проектные архитектурные/UX-контракты → существующие repository-local роли `kafedra-*` → выбранные профильные skills. Orchestrator не заменяет GRACE и не создаёт второй контур полномочий. Для чистого backend/infrastructure/release изменения без document-workspace или UX-составляющей допустим результат `focused profile skills: none`, но сам orchestrator preflight всё равно выполняется.

Для document/workspace задач выбирать только относящиеся к сценарию skills: intake/processing → `kafedra-document-intake` + `kafedra-states-and-recovery`; source/evidence/detail → `kafedra-provenance-and-inspector`; clutter/click tax → `kafedra-action-recomposition`; ambiguity → `kafedra-review-by-exception`; search/navigation → `kafedra-search-and-navigation`; responsive detail → `kafedra-responsive-inspector`; adaptive defaults → `kafedra-adaptive-controls`; plan/calendar → `kafedra-plan-calendar-continuity`; templates → `kafedra-template-and-structured-document-flow`; motion → `kafedra-motion-continuity`; итоговая UX-проверка → `kafedra-ux-acceptance`.

Ссылки внутри vendored upstream skills на общие library helpers (`anti-slop-ui-direction`, `dense-controls-and-selection` и подобные) являются необязательными подсказками исходной библиотеки. Kafedra Planner не зависит от их установки: при их отсутствии используются локальные `kafedra-flow-intake`, `kafedra-design`, `kafedra-motion`, `kafedra-feature`, `kafedra-design-audit` и `kafedra-tests`. Происхождение snapshot и процедура обновления описаны в `docs/AI_SKILLS_PROFILE.md`.

## Запись в GitHub из ChatGPT

При команде пользователя «сделай коммит», «слей в main» или аналогичной сначала нужно обнаружить полный набор GitHub actions. Нельзя делать вывод о read-only доступе только потому, что отсутствуют `gh`, локальный `.git`, shell credentials или OAuth-токен в окружении.

Если GitHub write actions доступны, для нескольких связанных файлов использовать атомарную последовательность:

```text
fetch refs/heads/main и tree SHA
        ↓
create_blob для каждого изменённого файла
        ↓
create_tree(base_tree = проверенный tree SHA)
        ↓
create_commit(parent = проверенный HEAD)
        ↓
update_ref(рабочая ветка, force = false)
        ↓
compare_commits
        ↓
обычный PR в main
        ↓
обязательный CI
        ↓
squash merge с проверкой head SHA
        ↓
повторная проверка refs/heads/main и post-merge CI
```

Для одиночного файла допустим `update_file`, если это не разрушает атомарность сценария. `update_ref` должен передвигать рабочую ветку; итоговое изменение `main` выполняется через проверенный PR и squash merge.

Перед `update_ref` повторно убедиться, что parent соответствует ветке. Не использовать `force=true` для обхода параллельных изменений. Если `main` успел измениться и это влияет на mergeability, перестроить изменение поверх нового HEAD.

Перед слиянием повторно проверить:

- фактический head SHA PR;
- mergeability и отсутствие конфликтов;
- review threads/замечания;
- все обязательные jobs: нельзя сливать при `pending`, `failure`, `cancelled` или неожиданном `skipped`.

После squash merge обязательно получить новый SHA `main` и проверить post-merge CI. Нельзя сообщать о созданном коммите, PR, merge или зелёном CI, пока соответствующий объект фактически не подтверждён GitHub API.

Если после discovery write-actions действительно отсутствуют, сообщить именно об отсутствии GitHub write actions в текущей сессии. Отсутствие `gh` само по себе причиной не является.

## Обучаемый, но стабильный UX

Интерфейс должен быть минималистичным, понятным без инструкции и обучаемым на повторяющихся действиях пользователя, но **не должен визуально перестраиваться от статистики использования**. Это правило относится ко всему интерфейсу, а не к отдельным разделам.

Каждый новый или изменяемый интерактивный контрол при UX-аудите обязан быть отнесён к одному из четырёх классов:

1. **safe-default** — безопасный выбор при создании нового объекта. Частый явный выбор может стать значением по умолчанию; варианты внутри списка можно ранжировать.
2. **rank-only** — фильтр или редактирование существующего объекта. Частые варианты можно поднять внутри раскрывающегося списка, но нейтральное или уже сохранённое значение нельзя молча заменить.
3. **domain-derived** — значение надёжно выводится из предметных данных или контекста. Такая автоматика важнее статистики: выбранный день календаря, руководитель сотрудника, сохранённая дата объекта, следующий период плана и другие подтверждённые значения не переопределяются learned default.
4. **never-learn** — пароль, токен, логин, поисковый запрос, свободный деловой текст, ACL, роль аккаунта, подтверждение/возврат/отклонение, удаление и любое действие, где частотный default способен изменить полномочия или предметное решение.

Общие инварианты:

- Положение кнопок, вкладок, секций и основных действий фиксировано. Частота использования никогда не переставляет их по экрану и не меняет иерархию интерфейса.
- Учитываются только явные действия человека. Для сохраняемого предметного действия частота увеличивается только после успешного сохранения; для чистого режима/фильтра завершённым действием считается сам явный выбор.
- Автоматически предложенное или программно подставленное значение, которое пользователь не менял, частоту не увеличивает.
- Явный выбор пользователя в текущем сеансе всегда важнее накопленной статистики и не должен «отскакивать» обратно к частому варианту сразу после выбора.
- Сохранённое предметное значение существующего объекта всегда важнее обученного значения по умолчанию.
- В раскрывающемся списке частые варианты разрешено ранжировать, но placeholder/нейтральный и служебные варианты остаются на логическом месте.
- Для checkbox/radio можно использовать наиболее частое явно выбранное состояние только в классе `safe-default`; флаги ACL, разрешений и предметных решений не обучаются.
- Для группы кнопок статистика может выбирать стартовый режим только там, где это безопасный UI-режим; порядок самих кнопок неизменен.
- Даты нового действия нельзя запоминать как устаревающий абсолютный `YYYY-MM-DD`. Если дата обучается, хранится ограниченное относительное смещение от понятной базовой даты; явно выбранная дата/предметная автоматика имеет приоритет.
- Текст запоминается только в явно разрешённых повторно используемых несекретных словарных полях. Нельзя автоматически обучаться на паролях, поисковых запросах, комментариях, названиях документов/задач и произвольном деловом тексте.
- Постоянная серверная настройка пользователя не дублируется в preference-layer только ради «обучаемости»: если значение уже сохраняется как собственная настройка, именно она остаётся источником истины.
- Новые обучаемые контексты добавляются только в единый серверный allowlist пользовательских предпочтений, с понятным fallback и regression-тестом. Не создавать локальные параллельные механизмы «последнего/частого выбора»; `localStorage` допустим только как совместимый/автономный кэш или fallback при отключённой авторизации.
- Ошибка чтения или записи UX-предпочтения не должна блокировать основное действие. Это вспомогательная персональная проекция, а не источник предметной истины.
- При добавлении формы необходимо проверить desktop/mobile и отдельным тестом доказать, что программная подстановка не считается пользовательским выбором.

Подробный контракт и разрешённые контексты: `docs/ADAPTIVE_UX.md`.

## Apple-inspired дизайн и motion

`docs/design.md` задаёт обязательный продуктовый характер: ясная иерархия, спокойная плотность, стабильная геометрия, системная предсказуемость, понятные русские действия и restrained material. Apple-inspired означает дисциплину и качество взаимодействия, а не копирование Apple assets/screens.

`docs/MOTION_DESIGN.md` и `codex/skills/kafedra-motion/` задают motion-контракт. Анимация используется только для причинности, ориентации, direct manipulation и локального feedback; routine actions не получают декоративный bounce/задержку. Статическое состояние всегда остаётся понятным, а `prefers-reduced-motion` проектируется явно.

Для UI-scoped GRACE change (`ObservedWriteScope` содержит `public/**` или конкретный `public/...`) specialist path обязателен: `kafedra-design → kafedra-motion → kafedra-feature → kafedra-design-audit → kafedra-tests`. Motion worker может выдать `no-motion`, но стадия решения не пропускается. Design audit выполняется после реализации и не является самооценкой автора дизайна/фичи.

## Качество изменения

- Реализовывать минимальный вертикальный сценарий целиком: причина → domain/API/storage → UI → ошибки → tests → документация, когда эти слои затронуты.
- Не оставлять заглушки, фиктивные данные, TODO, временные обходы и мёртвый код.
- Сохранять исходные документы, доказательства и историю изменений; повторная обработка должна оставаться идемпотентной.
- Не добавлять обязательные внешние сервисы, CDN, Docker или LLM-зависимость. Основной сценарий должен работать автономно на Debian/Astra Linux.
- Новые пользовательские сценарии проверять unit/integration и Playwright там, где есть UI; учитывать desktop и mobile.
- Локальная или фокусная проверка не заменяет полный GitHub CI.
- После изменения синхронизировать затронутые README/VERSION/ROADMAP/архитектурные документы только тогда, когда меняется соответствующий контракт или рубеж продукта.

## Codex project roles

Repository-local role skills live in `codex/skills/`; their shared routing is in `docs/CODEX_AGENTS.md` and their design contract is `docs/design.md`. For a matching task, read the role skill before acting:

- `kafedra-flow-intake` for a new or materially changed user workflow;
- `kafedra-design` for interaction, hierarchy, layout, responsive UX and Apple-inspired product character;
- `kafedra-motion` for motion/no-motion decisions, reference retrieval, measurable timing/geometry/gesture/reduced-motion briefs;
- `kafedra-design-audit` for independent post-implementation UI/motion/accessibility/responsive audit;
- `kafedra-data` for persisted data, entities, migrations, projections, or recovery;
- `kafedra-tests` for test strategy or coverage;
- `kafedra-feature` for implementation of a vertical slice;
- `kafedra-release` for versioning, migration rollout, offline deployment, backup/restore, or rollback.

Follow the documented handoff whenever the task crosses roles. These skills refine project-specific decisions; they do not replace authorization boundaries or the mandatory CI/release gates above.

## GRACE 4 development lifecycle

GRACE 4 является обязательным внешним lifecycle для существенных изменений. Repository-local `kafedra-*` skills остаются специалистами внутри задач GRACE и не заменяют `GraceChangeSpec`, `GraceChangePlan`, scopes или verification gates.

Перед первой записью в governed-код:

1. Получить точный `main` SHA, создать короткую ветку и связанный Issue.
2. Проверить `grace status --path .` и соответствующие `M-*`, `DF-*`, `V-M-*`.
3. Создать один `.grace/changes/active/C-*` с `spec.xml` через `grace-spec`; существенная реализация начинается только после `status="approved"`.
4. Создать `plan.xml` через `grace-plan`; план должен иметь machine-checkable baseline/target assertions, `DurableScope`, `ObservedWriteScope` и `T-*` задачи. Реализация начинается только после явного `status="approved"`.
5. До observed writes выполнить `grace lint --path . --assertions current` и `grace lint --path . --change C-ID --assertions baseline --run-commands`.

Во время реализации:

- `kafedra-flow-intake`, `kafedra-design`, `kafedra-motion`, `kafedra-data`, `kafedra-feature`, `kafedra-design-audit`, `kafedra-tests`, `kafedra-release` используются как specialist workers для соответствующих `T-*`;
- каждый worker пишет только в утверждённый `ObservedWriteScope`;
- approved plan не расширяется задним числом. Изменение scope/assertions/acceptance criteria требует нового superseding `C-*`;
- параллельное исполнение допускается только после `grace lint --path . --parallel-preflight` и при отсутствии пересекающихся durable/observed scopes;
- миграции SQLite append-only: уже присутствующий в base SQL-файл нельзя изменять, переименовывать или удалять; новый schema change требует следующего последовательного номера, migration regression test, `M-DATABASE`/`V-M-DATABASE`, clean-install, base→HEAD upgrade, `quick_check`, `foreign_key_check`, backup и restore evidence;
- GRACE/Bun являются только dev/CI tooling и не добавляются в runtime/offline bundle.

Для UI-scoped GRACE plan:

1. `kafedra-design` фиксирует flow, hierarchy, desktop/mobile и accessibility acceptance.
2. `kafedra-motion` фиксирует motion brief или явный `no-motion`; `prefers-reduced-motion` обязателен в acceptance.
3. `kafedra-feature` реализует только после этих решений.
4. `kafedra-design-audit` независимо проверяет фактическую реализацию и возвращает `PASS`, `REVISE` или `BLOCK`.
5. Только после `PASS` UI-поток передаётся `kafedra-tests` и release/final gates.
6. `npm run design:check` / `scripts/design-governance.mjs` fail-closed проверяет наличие и порядок этих стадий в active GRACE plan.

Перед PR/merge:

1. Выполнить selected target/final gates: `grace lint --path . --change C-ID --assertions target --run-commands` и затем `--assertions final --run-commands`.
2. GitHub обязан подтвердить `GRACE / merge-gate`, весь существующий project CI и `release-gate` на одном неизменившемся PR head SHA.
3. Нельзя считать `pending`, `failure`, `cancelled`, отсутствующий или неожиданный `skipped` достаточным доказательством.
4. Слияние — только squash merge через PR с повторной проверкой exact head SHA, mergeability, review threads и required checks.
5. После merge получить новый `main` SHA и подтвердить post-merge CI. Только после этого C-* получает terminal `applied` и переносится в `.grace/changes/archive/`.

Машинные правила, required checks и административная защита `main` описаны в `docs/GRACE_GOVERNANCE.md`. `scripts/grace-governance.mjs`, `scripts/design-governance.mjs` и `.github/workflows/grace.yml` являются fail-closed enforcement layer поверх инструкций агенту.
